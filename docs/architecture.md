# Documentation technique — Monitoring EHPAD IoT/IA

## 1. Vue d'ensemble

Plateforme de surveillance temps réel de 20 résidents. Architecture micro-services orchestrée par Docker Compose, totalement auto-contenue (aucune dépendance externe en production sauf le pull initial de l'image LLM Ollama).

### Objectifs métier
1. Détecter les anomalies vitales en quasi-temps réel (< 2 s entre capteur et alerte).
2. Anticiper les dégradations avant que les seuils cliniques ne soient franchis (ML).
3. Notifier le personnel selon une grille de criticité 5 niveaux avec auto-escalade.
4. Détecter les sorties à risque (fugues) chez les résidents désorientés.
5. Produire un rapport quotidien synthétique généré par LLM local.

---

## 2. Architecture des services

```
┌──────────────┐    MQTT     ┌──────────────┐
│  Simulateur  │ ──────────▶ │  Mosquitto   │
│   (20 res.)  │             │  (broker)    │
└──────────────┘             └──────┬───────┘
                                    │ subscribe
                ┌───────────────────┼───────────────────┐
                ▼                                       ▼
        ┌──────────────┐                       ┌──────────────┐
        │   Backend    │                       │  WS-Gateway  │
        │  (FastAPI)   │                       │   (Node)     │
        └──┬────┬────┬─┘                       └──────┬───────┘
           │    │    │                                │
           ▼    ▼    ▼                                ▼ WebSocket
      Redis Influx Ollama                       ┌──────────────┐
       cache  TS    LLM                         │   Frontend   │
                                                │ (React+nginx)│
                                                └──────────────┘
                                                       ▲
                                                       │ HTTP
                                                       │ proxy /api /sim /ws
                                                  Browser
```

### Détail des services Docker

| Service | Image | Port | Rôle |
| --- | --- | --- | --- |
| `mosquitto` | `eclipse-mosquitto:2` | 1883 | Broker MQTT |
| `redis` | `redis:7-alpine` | 6379 | Cache d'état temps réel |
| `influxdb` | `influxdb:2.7` | 8086 | Historique time-series |
| `simulator` | image locale (Python) | 9100 | Génération de capteurs synthétiques |
| `backend` | image locale (Python) | 8000 | API REST + moteur d'alertes + ML + LLM client |
| `ws-gateway` | image locale (Node) | 8080 | Bridge MQTT ↔ WebSocket |
| `ollama` | `ollama/ollama:latest` | 11434 | Inférence LLM locale |
| `ollama-init` | `ollama/ollama:latest` | — | Pull du modèle au boot |
| `frontend` | image locale (nginx) | 3000 | UI React + reverse-proxy |

---

## 3. Flux de données

### 3.1 Ingestion (capteur → état)

1. **Simulateur** (Python asyncio, 4 boucles par résident + 1 globale) :
   - `vitals_loop` 1 Hz → `ehpad/vitals/resident/{rid}` `{hr, spo2, sys, dia, temp}`
   - `motion_loop` 5 Hz → `ehpad/motion/resident/{rid}` `{ax, ay, az, activity}`
   - `ambient_loop` 0,2 Hz → `ehpad/ambient/room/{room}` PIR + `ehpad/door/room/{room}` état porte
   - `routine_loop` 30 s → met à jour `activity` selon l'heure et la mobilité

2. **Backend MQTT client** (`paho-mqtt`) souscrit à `ehpad/+/+/+`. Pour chaque message :
   - Validation Pydantic (`VitalsPayload`, `MotionPayload`, `AmbientPayload`).
   - Merge dans Redis : `state:resident:{rid}` (TTL 60 s) ou `state:room:{room}` (TTL 60 s).
   - Push vers la fenêtre ML : `ml:window:{rid}` (LPUSH + LTRIM 900).
   - Écriture Influx : measurement `vitals` ou `motion` taggé `resident_id`.
   - Re-publication de l'état mergé sur `ehpad/state/resident/{rid}` ou `ehpad/state/room/{room}` pour le frontend.

### 3.2 Évaluation des alertes

Boucle backend à 1 Hz :
1. Récupère la liste des résidents actifs depuis Redis (`scan` pattern `state:resident:*`).
2. Pour chaque résident :
   - Charge l'état + l'état de sa chambre.
   - Évalue les règles seuils (`rules.evaluate`) → niveau 1–5 ou rien.
   - Évalue la fugue (`fugue.evaluate_fugue`) → niveau 4 ou rien.
   - Garde le niveau le plus élevé.
   - Compare avec l'alerte active existante (sticky : descend pas).
   - Crée / monte l'alerte → publie sur `ehpad/alerts/new` ou `ehpad/alerts/update/{id}`.

### 3.3 Auto-escalade

Quand une alerte est créée à un niveau N, un timer asyncio est planifié. Si aucun acquittement n'est reçu avant l'échéance :
- L1 → L2 : 5 min (compressé à 30 s en `DEMO_MODE`)
- L2 → L3 : 10 min (60 s)
- L3 → L4 : 15 min (90 s)
- L4 → L5 : 5 min (30 s)

L'acquittement (`POST /alerts/{id}/ack`) annule le timer.

### 3.4 Score ML hybride

Toutes les 30 s, pour chaque résident :
1. **Anomaly** (`ml/anomaly.py`) : un `IsolationForest` par résident, entraîné au boot sur 7 jours synthétiques (`ml/bootstrap.py`), persisté dans `/models/{rid}.joblib`. Score = `[0..1]` selon la décision normalisée.
2. **Trend** (`ml/trend.py`) : régression linéaire sur les 15 dernières minutes (Redis `ml:window`) → pente de HR, SpO2, temp. Score = combinaison normalisée des pentes anormales.
3. **Combined** (`ml/risk.py`) : `risk = 0.6 × anomaly + 0.4 × trend`.
4. Écriture dans `state:resident:{rid}.risk`, publication `ehpad/risk/resident/{rid}`, audit Influx (measurement `risk`).

Si `risk > 0.6`, le moteur d'alertes émet un L3 (« ml risk »).

### 3.5 Détection de fugue (bonus C1)

Détecteur `backend/app/alerts/fugue.py` appelé à chaque tick du moteur. Conditions :
- Porte de la chambre ouverte (`room.door == 1`) **ET** une des deux :
  - `state.scenario == "fugue"` (déclenchement explicite via simulateur).
  - Pathologie cognitive (Alzheimer / démence dans `profiles.PROFILES`) **ET** `motion.activity == "walking"`.

Émet une alerte L4 URGENCE avec un message contextualisé incluant le nom du résident.

### 3.6 Résumé LLM quotidien (bonus C2)

Endpoint `GET /residents/{id}/summary?hours=24` :
1. Agrège depuis Influx : statistiques vitales (count, avg, min, max), activités totales, alertes par niveau (dédupliquées par `alert_id`).
2. Construit un prompt structuré contenant : profil, antécédents, données agrégées.
3. POST à `http://ollama:11434/api/chat` avec un system prompt en français cadrant le format markdown.
4. Repli automatique sur un template déterministe si Ollama échoue ou renvoie vide.

Modèle par défaut : `llama3.2:3b` (~2 GB). Pull via service `ollama-init` au démarrage.

### 3.7 Distribution temps réel

Le service `ws-gateway` (Node) :
- Souscrit à `ehpad/state/#`, `ehpad/alerts/#`, `ehpad/risk/+`.
- Pour chaque message, broadcast à tous les clients WebSocket connectés sous forme `{ topic, data }` (préfixe `ehpad/` retiré).

Le frontend ouvre une seule connexion WS avec reconnexion exponentielle (`frontend/src/lib/ws.ts`), met à jour le store Zustand selon le topic.

---

## 4. Modèle de données

### 4.1 Redis (cache)

| Clé | Type | TTL | Contenu |
| --- | --- | --- | --- |
| `state:resident:{id}` | string JSON | 60 s | `{last_seen, vitals, motion, scenario, risk}` |
| `state:room:{id}` | string JSON | 60 s | `{room_id, resident_id, pir, door, last_seen}` |
| `ml:window:{id}` | list | — | 900 derniers échantillons vitals (1 Hz × 15 min) |
| `alerts:active` | set | — | IDs des alertes actives |
| `alerts:detail:{id}` | string JSON | — | Détail de l'alerte |
| `alerts:by_resident:{rid}` | string | — | ID de l'alerte active du résident |

### 4.2 InfluxDB (historique)

| Measurement | Tags | Fields |
| --- | --- | --- |
| `vitals` | `resident_id` | `hr`, `spo2`, `sys`, `dia`, `temp` |
| `motion` | `resident_id`, `activity` | `ax`, `ay`, `az` |
| `risk` | `resident_id` | `anomaly`, `trend`, `combined` |
| `alerts` | `resident_id`, `alert_id`, `status` | `level`, `reason` |

Bucket : `ehpad_vitals`, rétention 30 jours.

### 4.3 Profil résident

Registre statique `backend/app/profiles.py` mirroir de `simulator/profiles.json` :

```python
PROFILES = {
    "R003": {"name": "Suzanne L.", "age": 88, "room": "103",
             "pathologies": ["alzheimer", "copd"]},
    ...
}
```

Pathologies cognitives détectées : `alzheimer`, `dementia`. Utilisées par le détecteur de fugue.

---

## 5. Topics MQTT

| Topic | QoS | Émetteur | Description |
| --- | --- | --- | --- |
| `ehpad/vitals/resident/{rid}` | 0 | simulator | Constantes vitales 1 Hz |
| `ehpad/motion/resident/{rid}` | 0 | simulator | Accélérométrie + activité 5 Hz |
| `ehpad/ambient/room/{room}` | 0 | simulator | PIR (mouvement) |
| `ehpad/door/room/{room}` | 0 | simulator | État porte |
| `ehpad/state/resident/{rid}` | 0 | backend | État mergé re-publié |
| `ehpad/state/room/{room}` | 0 | backend | État chambre mergé |
| `ehpad/risk/resident/{rid}` | 0 | backend | Score ML 30 s |
| `ehpad/alerts/new` | 1 | backend | Nouvelle alerte |
| `ehpad/alerts/update/{id}` | 1 | backend | Changement statut/niveau |

---

## 6. Niveaux d'alerte

| Niveau | Nom | Critères types | Action attendue |
| --- | --- | --- | --- |
| 1 | Information | Déviation légère (temp 37,5–38, HR 50–58) | Surveillance passive |
| 2 | Attention | HR > 100, SpO2 88–94, temp < 35,5 ou > 38 | Visite infirmière |
| 3 | Alerte | SpO2 < 93, ML risk > 0,6 | Évaluation médicale |
| 4 | Urgence | Chute, HR < 40 ou > 140, SpO2 < 88, fugue | Intervention immédiate |
| 5 | Danger vital | HR critique + SpO2 < 85 simultanés | Réanimation / SAMU |

---

## 7. Frontend

### Pages
- `/` — Grille des 20 résidents (tri : niveau d'alerte desc, puis ID).
- `/resident/:id` — Détail : constantes en temps réel, jauges, historique 15 min, alertes actives, scénarios, plan de chambre, **rapport quotidien LLM**.
- `/alerts` — Journal complet avec filtres et actions Ack/Resolve.
- `/movements` — Plan de l'EHPAD avec mouvements PIR et état des portes.
- `/personnel` — Gestion du personnel + assignation par aile.

### Stack
- React 18 + Vite 5 + TypeScript 5 + Tailwind 3.
- Zustand pour l'état global (résidents, alertes, salles, gardiens).
- React-Router 6.
- Recharts pour les time-series.
- Reverse-proxy nginx → `/api` (backend), `/sim` (simulator), `/ws` (gateway).

### Robustesse
- WebSocket reconnect exponentiel (500 ms → 5 s max).
- Debounce 2,5 s sur la transition « connecté → déconnecté » pour absorber les micro-coupures et le double-mount StrictMode.
- Refresh automatique des historiques toutes les 5 s sur la page détail.

---

## 8. Choix techniques et compromis

### Pourquoi MQTT ?
Protocole standard IoT, support QoS 0/1, broker léger. Permet de découpler simulateur, backend et front. Évite tout couplage HTTP fragile.

### Pourquoi Redis + Influx ?
- **Redis** : cache O(1) pour l'état courant, TTL natif (60 s = freshness garantie sans ménage explicite).
- **Influx** : optimisé pour les écritures massives time-series et les requêtes de fenêtre temporelle.

### Pourquoi un IsolationForest par résident ?
Chaque profil a une baseline propre (HR baseline = 35 pour R005, 110 pour R007). Un modèle global produirait trop de faux positifs sur les résidents atypiques. Coût mémoire négligeable (~50 KB/modèle).

### Pourquoi DEMO_MODE ?
Les délais cliniques réels (10 min entre L2 et L3) rendent la démo impossible. `DEMO_MODE=true` divise par ~10. Production : `false`.

### Pourquoi un LLM local (Ollama) ?
- Pas de clé API requise.
- Pas de fuite de données médicales vers un fournisseur externe.
- Inférence offline, prévisible.
- Compromis : cold-start ~2 min au premier appel, latence 10–30 s ensuite. Repli template garantit que l'endpoint répond toujours.

### Pourquoi un `nginx` devant le frontend ?
Évite les problèmes CORS (browser → un seul origin), gère le reverse-proxy `/api`, `/sim`, `/ws`, sert les assets statiques compressés. Le timeout `/api` est porté à 300 s pour absorber les appels LLM.

### Pourquoi Pydantic v2 ?
Validation rapide des payloads MQTT (gain x10 vs v1), erreurs explicites, intégration FastAPI native.

---

## 9. Tests

Suite pytest (~60 tests, < 5 s) couvrant :
- Règles d'alertes (limites, levels, sticky behaviour)
- Moteur d'escalade (timers, annulation, chaînage L2→L5)
- Store Redis (CRUD alertes, indexation par résident)
- Handlers d'ingestion (validation, merge, écriture)
- ML (entraînement, scoring, fenêtre glissante)
- Trend (régression, pente)

```bash
cd backend && pytest -q
```

---

## 10. Limites connues

- Pas d'authentification (démo).
- Pas de rate-limiting sur les endpoints publics.
- Le LLM repli template ne couvre pas la section « Recommandations » du LLM réel.
- Le pull Ollama (~2 GB) bloque le premier `up -d` ~30 s à 2 min selon la connexion.
- Les données sont éphémères (volumes Docker locaux). Pas de backup.

---

## 11. Évolutions futures

- Authentification OAuth2 / SSO infirmier.
- Push notifications mobiles (FCM/APNS).
- Stockage S3 des modèles ML pour multi-instance.
- A/B test du LLM (llama3.2 vs mistral vs phi3).
- Détecteur de fugue géofencé (zones interdites multi-pièces).
- Intégration capteurs réels (Bluetooth LE, LoRaWAN).
