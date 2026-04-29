Projet 2 : Détection de malaise en
EHPAD
Cahier des charges
s
Module : IoT / Santé / Intelligence Artificielle — Epitech MBA1
Date : Mars 2026

Contenu du cahier des charges
1. Contexte
En France, 10 000 décès par an sont liés à des chutes chez les personnes âgées. En EHPAD, le délai de détection d'un malaise ou d'une chute est un
facteur critique : chaque minute compte.
Un groupe d'EHPAD vous mandate pour concevoir un système intelligent de détection et prédiction de malaises basé sur l'IoT et l'IA, couvrant l'ensemble
des résidents d'un établissement.
2. Objectifs
Simuler un EHPAD avec 20+ résidents équipés de capteurs
Détecter en temps réel les malaises, chutes et anomalies
Prédire les risques de malaise (pas seulement détecter)
Alerter le personnel avec un système gradué à 5 niveaux
Fournir un tableau de bord multi-résidents
3. Différences clés avec le Projet 1
| Aspect      |     | Projet 1 (Post-op)  |     |     |     | Projet 2 (EHPAD)                         |     |     |
| ----------- | --- | ------------------- | --- | --- | --- | ---------------------------------------- | --- | --- |
| Nb patients |     | 3-5                 |     |     |     | 20-50 résidents                          |     |     |
| Durée       |     | Semaines            |     |     |     | Continu (mois/années)                    |     |     |
| Focus IA    |     | Détection anomalies |     |     |     | Prédiction de malaise                    |     |     |
| Alertes     |     | 3-4 niveaux         |     |     |     | 5 niveaux gradués                        |     |     |
| Capteurs    |     | Vitaux portés       |     |     |     | Vitaux + ambiants                        |     |     |
| Vue         |     | Par patient         |     |     |     | Vue globale établissement + par résident |     |     |
| Complexité  |     | Moyenne             |     |     |     | Élevée (scale + prédiction)              |     |     |
4. Fonctionnalités — MoSCoW
 MUST HAVE (OBLIGATOIRE)
ý
| #   | Fonctionnalité |     |     | Description |     |     |     |     |
| --- | -------------- | --- | --- | ----------- | --- | --- | --- | --- |
M1 Simulateur 20+ résidents Profils variés (âge, pathologies, mobilité). Données : FC, SpO2, PA, T°, accéléromètre
(mouvement/chute)
M2 Capteurs ambiants Simuler capteurs de mouvement pièces (lit, salle commune, couloir), porte chambre
| M3  | Communication MQTT |     |     | Topics par résident et par zone, QoS adapté |     |     |     |     |
| --- | ------------------ | --- | --- | ------------------------------------------- | --- | --- | --- | --- |
M4 Dashboard multi-résidents Vue globale avec état de chaque résident (grille). Drill-down par résident
| M5  | Alertes 5 niveaux |     |     | Système d'alertes gradué (voir ci-dessous) |     |     |     |     |
| --- | ----------------- | --- | --- | ------------------------------------------ | --- | --- | --- | --- |
| M6  | Docker Compose    |     |     | Tout démarre avec docker compose up        |     |     |     |     |
| M7  | Documentation     |     |     | README, architecture, instructions         |     |     |     |     |
 SHOULD HAVE (ATTENDU)
Ā
| #   | Fonctionnalité |     |     | Description |     |     |     |     |
| --- | -------------- | --- | --- | ----------- | --- | --- | --- | --- |
S1 Prédiction de malaise Modèle ML qui prédit un risque de malaise dans les 30-60 min à venir (pas seulement détecte
après coup)
S2 Plan de l'établissement Vue schématique de l'EHPAD avec position/état des résidents
S3 Historique comportemental Patterns de routine par résident (heures lever/coucher, activité, repas)
S4 Escalade automatique Si alerte non acquittée en X min → escalade au niveau supérieur
S5 Gestion du personnel Assignation soignant de garde, notification au bon soignant
 COULD HAVE (BONUS)
ā
| #   | Fonctionnalité     |     |     | Description                                  |     |     |     |     |
| --- | ------------------ | --- | --- | -------------------------------------------- | --- | --- | --- | --- |
| C1  | Détection de fugue |     |     | Alerte si résident désorienté quitte l'EHPAD |     |     |     |     |
| C2  | Résumé LLM         |     |     | Rapport quotidien automatique par résident   |     |     |     |     |
C3 Interface famille Accès restreint pour les proches (état général, pas de détails médicaux)
C4 Analyse de routine Détection de changement de comportement (dort plus, mange moins)
| C5  | Tests automatisés |     |     | Tests unitaires et/ou d'intégration |     |     |     |     |
| --- | ----------------- | --- | --- | ----------------------------------- | --- | --- | --- | --- |
5. Système d'alertes — 5 niveaux
| Nive | Nom |     | Couleur | Déclencheur (exemples) |     |     | Action |     |
| ---- | --- | --- | ------- | ---------------------- | --- | --- | ------ | --- |
au
1 Information  Bleu Résident inactif depuis 30 min Log + icône dashboard
þ
2 Attention  Jaune Constante légèrement hors norme,  Notification soignant assigné
Ā
changement routine
3 Alerte  Orange SpO2 < 93%, pas de mouvement depuis 1h,  Notification + alerte sonore poste
ÿ
ML prédit risque
4 Urgence  Rouge Chute détectée, constantes critiques Tous soignants + alerte sonore forte
ý
5 Danger vital  Noir Arrêt mouvement + constantes critiques,  SAMU (15) + direction + tous soignants
⚫
alerte non acquittée niveau 4
Règles d'escalade
| Niveau 2 → 3 |     |     |     | Niveau 3 → 4 |     |     | Niveau 4 → 5 |     |
| ------------ | --- | --- | --- | ------------ | --- | --- | ------------ | --- |
Alerte niveau 2 non acquittée en 10 min →  Alerte niveau 3 non acquittée en 5 min →  Alerte niveau 4 non acquittée en 3 min →
| passe en niveau 3 |     |     |     | passe en niveau 4 |     |     | passe en niveau 5 |     |
| ----------------- | --- | --- | --- | ----------------- | --- | --- | ----------------- | --- |
6. Barème détaillé — /100 points
| Fonctionnalités (40 points) |     |     |       |        | Qualité technique (25 points) |     |       |        |
| --------------------------- | --- | --- | ----- | ------ | ----------------------------- | --- | ----- | ------ |
| Critère                     |     |     | Point | Détail | Critère                       |     | Point | Détail |
|                             |     |     | s     |        |                               |     | s     |        |
M1 - Simulateur 20+ 6 Multi-résidents,  Architecture 8 Scalabilité (20+ résidents),
|     |     |     |     | profils réalistes,  |     |     |     | séparation concerns |
| --- | --- | --- | --- | ------------------- | --- | --- | --- | ------------------- |
données variées
|                        |     |     |     |             | Code quality |     | 7   | Lisible, modulaire, bien  |
| ---------------------- | --- | --- | --- | ----------- | ------------ | --- | --- | ------------------------- |
| M2 - Capteurs ambiants |     |     | 4   | Mouvement,  |              |     |     | structuré                 |
portes, activité
|     |     |     |     | zones  | Git |     | 5   | Historique propre, branches,  |
| --- | --- | --- | --- | ------ | --- | --- | --- | ----------------------------- |
collaboration visible
communes
|           |     |     |     |         | Performance |     | 5   | Gestion du volume de  |
| --------- | --- | --- | --- | ------- | ----------- | --- | --- | --------------------- |
| M3 - MQTT |     |     | 4   | Topics  |             |     |     |                       |
données (20+ résidents en
structurés, QoS,
temps réel)
volume géré
M4 - Dashboard 10 Vue globale +  Présentation & Démo (15 points)
détail,
responsive, UX
|     |     |     |     |     | Critère |     | Point | Détail |
| --- | --- | --- | --- | --- | ------- | --- | ----- | ------ |
adaptée
s
| M5 - Alertes 5 niveaux |     |     | 6   | Tous les niveaux,  |           |     |     |                            |
| ---------------------- | --- | --- | --- | ------------------ | --------- | --- | --- | -------------------------- |
|                        |     |     |     |                    | Démo live |     | 8   | Scénario convaincant avec  |
escalade,
malaise détecté + escalade
acquittement
|             |     |     |     |               | Oral |     | 4   | Clair, structuré, tous parlent |
| ----------- | --- | --- | --- | ------------- | ---- | --- | --- | ------------------------------ |
| M6 - Docker |     |     | 5   | Tout démarre  |      |     |     |                                |
|             |     |     |     | proprement    | Q&A  |     | 3   | Maîtrise technique et          |
fonctionnelle
| M7 - Documentation |     |     | 5   | Complète et  |     |     |     |     |
| ------------------ | --- | --- | --- | ------------ | --- | --- | --- | --- |
claire
| Documentation (10 points) |     |       |        |     | Bonus (10 points) |     |       |        |
| ------------------------- | --- | ----- | ------ | --- | ----------------- | --- | ----- | ------ |
| Critère                   |     | Point | Détail |     | Critère           |     | Point | Détail |
|                           |     | s     |        |     |                   |     | s     |        |
README 4 Installation, lancement,  Should Have (S1-S5) 0-5 Chaque Should = +1 point
utilisation
|              |     |     |                            |     | Could Have (C1-C5) |     | 0-3 | Chaque Could = +0.5-1 point   |
| ------------ | --- | --- | -------------------------- | --- | ------------------ | --- | --- | ----------------------------- |
| Architecture |     | 3   | Schéma, justification des  |     |                    |     |     |                               |
|              |     |     |                            |     | Originalité        |     | 0-2 | Fonctionnalité pertinente et  |
choix
innovante
| Technique |     | 3   | API, formats données,  |     |     |     |     |     |
| --------- | --- | --- | ---------------------- | --- | --- | --- | --- | --- |
modèle ML documenté
7. Livrables
| #   | Livrable                   |     |     | Format                      |     |     | Échéance     |     |
| --- | -------------------------- | --- | --- | --------------------------- | --- | --- | ------------ | --- |
| 1   | Repository Git             |     |     | Lien GitHub/GitLab          |     |     | Jour 5 — 13h |     |
| 2   | Docker Compose fonctionnel |     |     | docker-compose.yml          |     |     | Jour 5 — 13h |     |
| 3   | README.md                  |     |     | Markdown                    |     |     | Jour 5 — 13h |     |
| 4   | Documentation technique    |     |     | Markdown ou PDF             |     |     | Jour 5 — 13h |     |
| 5   | Soutenance                 |     |     | Démo live 8 min + Q&A 5 min |     |     | Jour 5 — 14h |     |
8. Stack technique recommandée
Identique au Projet 1 avec en plus :
Redis pour le cache des derniers états (obligatoire avec 20+ résidents)
WebSocket recommandé pour la mise à jour du dashboard global
9. Planning suggéré
|     | Jour 3 (après-midi) — Sprint 0 |     |     |     |     | Jour 5 matin — Sprint 2 |     |     |
| --- | ------------------------------ | --- | --- | --- | --- | ----------------------- | --- | --- |
Équipe, rôles, architecture Prédiction ML si pas encore fait
Cloner projet2/base Should/Could Have
Docker Compose de base Documentation, tests
Répartition des tâches Préparation démo
|     |     | 1   |     |     | 2   |     | 3   |     |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
Jour 4 — Sprint 1
Matin : Simulateur 20+ résidents + MQTT + Stockage
Après-midi : Dashboard global + Alertes 5 niveaux
Soir : Intégration + premiers tests de charge
10. Conseil clé
La scalabilité est le défi principal de ce projet. 20 résidents × 6 constantes × 1 mesure/seconde = 120 messages MQTT par seconde. Pensez-y
dès la conception !
Scénario de démo suggéré : Montrer un résident dont les constantes se dégradent progressivement, l'alerte qui monte de niveau 1 à 4, et la
prédiction ML qui avait signalé le risque 30 min avant.
