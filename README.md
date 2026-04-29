# Projet 2 — Monitoring EHPAD (IoT / IA)

Plateforme de surveillance temps réel de 20 résidents en EHPAD. Capteurs simulés (constantes vitales, mouvement, ambiance), ingestion MQTT, scoring ML hybride (anomaly + tendance), moteur d'alertes 5 niveaux avec auto-escalade, détection de fugue, résumé quotidien généré par LLM local, et tableau de bord React temps réel.

L'ensemble s'exécute via un seul `docker compose up -d --build`.

---

## Démarrage rapide

```bash
git clone https://github.com/Usannazcedric/projet-2-iot-sante.git
cd projet-2-iot-sante
docker compose up -d --build
```

Attendre que les services soient `healthy` (~30 s, plus le pull du modèle Ollama ~2 GB au premier démarrage). Puis ouvrir :

- **Dashboard** : http://localhost:3000
- API backend : http://localhost:8000/health
- API simulator : http://localhost:9100/health
- WebSocket gateway : http://localhost:8080/health
- Ollama (LLM local) : http://localhost:11434

Vérifier l'état :

```bash
docker compose ps
```

---

## Stack technique

| Couche | Technologie |
| --- | --- |
| Simulateur capteurs | Python 3.11, FastAPI, asyncio, NumPy |
| Ingestion temps réel | MQTT (Eclipse Mosquitto 2) |
| Backend API + moteur d'alertes | Python 3.11, FastAPI, Pydantic v2, asyncio |
| Cache d'état temps réel | Redis 7 |
| Historique time-series | InfluxDB 2.7 |
| Machine Learning | scikit-learn (IsolationForest), NumPy |
| Pont WebSocket | Node 20, `ws`, `mqtt` |
| Frontend | React 18, Vite, TypeScript, Tailwind, Zustand, Recharts |
| LLM local (résumés) | Ollama (llama3.2:3b par défaut) |
| Orchestration | Docker Compose |

---

## Fonctionnalités

### Cœur (sprints 1–7)
- **Simulateur** : 20 profils résidents, scénarios injectables (chute, cardiaque, errance, dégradation lente), publication MQTT à 1 Hz (vitals) / 5 Hz (motion) / 0,2 Hz (ambient).
- **Backend** : ingestion MQTT, cache Redis (TTL 60 s), historique Influx, API REST documentée.
- **Moteur d'alertes** : 5 niveaux (Information → Danger vital), règles seuils + score ML, auto-escalade L2→L3→L4→L5 si non-acquittée. Sticky : descend pas, monte seulement.
- **ML hybride** : un IsolationForest par résident (entraîné au boot sur 7 jours synthétiques) + pente HR/SpO2/temp sur 15 min → `risk = 0.6 × anomaly + 0.4 × trend`. Mis à jour toutes les 30 s.
- **WebSocket gateway** : pont MQTT ↔ WebSocket pour pousser alertes/états/risques au front sans CORS.
- **Frontend** : grille des 20 résidents (triée par niveau d'alerte), page détaillée avec graphiques temps réel, journal d'alertes, plan de l'EHPAD avec mouvements, gestion du personnel et planning.

### Bonus (livraison finale)
- **C1 — Détection de fugue** : alerte L4 URGENCE quand un résident sort de sa chambre dans des conditions à risque. Deux paths :
  1. Pathologie cognitive (Alzheimer / démence) + porte ouverte + activité `walking` (détection organique).
  2. Scénario `fugue` injecté manuellement + porte ouverte (déclenchement explicite, indépendant du profil).
- **C2 — Résumé LLM quotidien** : endpoint `GET /residents/{id}/summary` qui agrège constantes, activité et alertes des 24 dernières heures, et produit un rapport markdown structuré (Synthèse / Constantes / Activité / Alertes / Recommandations) via le LLM Ollama local. Repli automatique sur un template déterministe si Ollama indisponible.

---

## Comment tester

### Voir une chute (alerte L4)
```bash
curl -X POST http://localhost:9100/scenario/R007 \
  -H 'Content-Type: application/json' -d '{"name":"fall"}'
```
Toast en haut à droite + badge dans NavBar + entrée dans `/alerts`.

### Voir une dégradation lente (ML prédit avant les seuils)
```bash
curl -X POST http://localhost:9100/scenario/R007 \
  -H 'Content-Type: application/json' -d '{"name":"degradation"}'
```
Le score de risque monte, l'alerte arrive avant que les seuils HR/SpO2 ne soient franchis.

### Voir une fugue (bonus C1)
1. Ouvrir n'importe quel résident dans le dashboard.
2. Bas de page → carte « Simulation de scénarios » → cliquer **Sortie / Fugue**.
3. ~5 s plus tard : toast top-right « Urgence — fugue détectée ».

Ou en CLI :
```bash
curl -X POST http://localhost:9100/scenario/R002 \
  -H 'Content-Type: application/json' -d '{"name":"fugue"}'
```

### Générer un rapport quotidien (bonus C2)
1. Ouvrir un résident.
2. Carte « Rapport quotidien » → bouton **Générer**.
3. Premier appel ~2 min (cold-start LLM), suivants <30 s.

---

## Endpoints API principaux

### Backend (port 8000)
| Méthode | Route | Description |
| --- | --- | --- |
| GET | `/health` | Statut des dépendances (Redis, Influx, MQTT) |
| GET | `/residents` | Snapshots des 20 résidents |
| GET | `/residents/{id}` | Détail d'un résident |
| GET | `/residents/{id}/history?metric=vitals&minutes=15` | Time-series Influx |
| GET | `/residents/{id}/activity-pattern?hours=24` | Répartition horaire des activités |
| GET | `/residents/{id}/summary?hours=24` | **Rapport LLM** (bonus C2) |
| GET | `/alerts` | Alertes actives |
| POST | `/alerts/{id}/ack` | Acquitter |
| POST | `/alerts/{id}/resolve` | Résoudre |
| GET | `/rooms` | États des chambres (PIR + porte) |
| GET | `/staff` | Personnel + assignation |

### Simulator (port 9100)
| Méthode | Route | Description |
| --- | --- | --- |
| GET | `/health` | Statut |
| GET | `/residents` | Profils complets |
| POST | `/scenario/{id}` body `{"name":"fall\|cardiac\|wandering\|degradation\|fugue\|normal"}` | Injecter un scénario |

### WebSocket (port 8080)
- `ws://localhost:8080/ws` — broadcast d'enveloppes `{ topic, data }`.
- Topics : `state/resident/{id}`, `state/room/{id}`, `alerts/new`, `alerts/update/{id}`, `risk/resident/{id}`.

---

## Variables d'environnement

| Variable | Service | Défaut | Rôle |
| --- | --- | --- | --- |
| `DEMO_MODE` | backend, simulator | `true` | Compresse les délais d'escalade (10 min → 60 s) |
| `MQTT_HOST` | tous | `mosquitto` | Hôte MQTT |
| `REDIS_URL` | backend | `redis://redis:6379` | URL Redis |
| `INFLUX_URL` | backend | `http://influxdb:8086` | URL Influx |
| `INFLUX_TOKEN` | backend | `ehpad-token-dev` | Token Influx (dev only) |
| `MODELS_DIR` | backend | `/models` | Persistance des modèles ML |
| `OLLAMA_URL` | backend | `http://ollama:11434` | URL Ollama |
| `OLLAMA_MODEL` | backend, ollama-init | `llama3.2:3b` | Modèle LLM utilisé |
| `RESIDENT_COUNT` | simulator | `20` | Nombre de résidents |

---

## Structure du projet

```
.
├── backend/              # FastAPI + moteur d'alertes + ML + LLM
│   ├── app/
│   │   ├── alerts/       # rules.py, fugue.py, engine.py, escalation.py
│   │   ├── api/          # routes HTTP
│   │   ├── ingest/       # client MQTT + handlers
│   │   ├── ml/           # IsolationForest + trend + risk publisher
│   │   ├── storage/      # Redis + Influx
│   │   ├── profiles.py   # registre statique des résidents
│   │   └── summary.py    # générateur de rapport LLM (bonus C2)
│   └── tests/            # 60+ tests pytest
├── simulator/            # FastAPI + asyncio publisher MQTT
│   └── app/
│       ├── scenarios.py  # Normal, Fall, Cardiac, Wandering, Degradation, Fugue
│       └── sensors/      # vitals, motion, ambient
├── ws-gateway/           # Node bridge MQTT ↔ WebSocket
├── frontend/             # React + Vite + TS + Tailwind
│   └── src/
│       ├── pages/        # Grid, ResidentDetail, AlertLog, Movements, Staff
│       ├── components/   # NavBar, AlertToast, FloorPlan, …
│       ├── hooks/        # useBootstrap (REST + WS)
│       └── store/        # Zustand
├── mosquitto/            # config MQTT
├── docker-compose.yml
├── docs/
│   └── architecture.md   # Documentation technique détaillée
└── README.md
```

---

## Tests

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
pytest -q          # ~60 tests, < 5 s
```

---

## Documentation technique

Voir [`docs/architecture.md`](docs/architecture.md) pour :
- diagramme d'architecture détaillé
- flux de données (capteur → MQTT → backend → cache → frontend)
- schéma de stockage (Redis keys, Influx measurements)
- modèle ML (entrée, sortie, ré-entraînement)
- contrat des messages MQTT
- choix techniques et compromis

---

## Auteurs

- Titouan Brunet
- Usannaz Cedric

Projet réalisé dans le cadre du Projet 2 — IoT Santé.
