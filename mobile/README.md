# AttestP2P — application mobile (React Native / Expo)

Panneau de controle mobile pour un noeud AttestP2P. L'application se connecte a
l'API HTTP de controle du noeud (qui tourne sur un PC) et permet de :

- voir le statut du noeud (sessions, pairs, fichiers, IA) ;
- lister les pairs, se connecter en bootstrap, approuver un pair (Web of Trust) ;
- discuter en chat chiffre (avec assistant IA via `/ask` ou `@attestp2p-ai`) ;
- partager et telecharger des fichiers (verification SHA-256 cote noeud).

Le code source (dossier `src/`) est volontairement simple et **entierement
modifiable** : composants React Native lisibles, aucune minification.

## Prerequis

- Node.js 18+ et npm
- L'application Expo Go sur le telephone (Play Store), OU un build APK (voir plus bas)
- Un noeud AttestP2P demarre sur le PC, accessible sur le reseau local :

```bash
# sur le PC (dans le dossier du protocole)
attestp2p start --control-host 0.0.0.0
# note l'IP du PC (ipconfig / ifconfig) et le port de controle (securePort + 1000, defaut 8778)
```

## Lancer en developpement (Expo Go)

```bash
cd mobile
npm install          # (ou: npx expo install  pour aligner les versions)
npx expo start       # scanne le QR code avec Expo Go ; PC et telephone sur le meme Wi-Fi
```

Dans l'app, saisir l'URL du noeud, par ex. `http://192.168.1.20:8778`.

## Construire un APK Android (installable)

Avec EAS Build (cloud, gratuit pour un usage perso) :

```bash
cd mobile
npm install -g eas-cli
eas login
eas build -p android --profile preview   # produit un .apk telechargeable
```

Ou en local (necessite Android SDK) :

```bash
npx expo prebuild -p android
cd android && ./gradlew assembleRelease   # apk dans android/app/build/outputs/apk/release
```

## Structure

```
App.js                     entree : navigation par onglets + fournisseur de contexte
app.json                   config Expo (nom, icone, package Android com.attestp2p.app)
assets/                    icone + splash (generes depuis le logo du projet)
src/
  theme.js                 couleurs
  api.js                   client HTTP de l'API de controle
  NodeContext.js           contexte : rafraichit statut/pairs/fichiers
  components/TabBar.js     barre d'onglets
  screens/
    ConnectScreen.js       saisie de l'URL du noeud
    StatusScreen.js        statistiques
    PeersScreen.js         pairs + bootstrap + trust
    ChatScreen.js          chat chiffre + IA
    FilesScreen.js         partage + telechargement
```

## Securite

L'API de controle n'a pas d'authentification : ne l'exposez (`--control-host 0.0.0.0`)
que sur un reseau de confiance. Sur un reseau public, gardez `127.0.0.1` et utilisez
un tunnel (SSH, VPN).
