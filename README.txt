NutriTrace v1.1 Local-First — pacchetto statico pronto per hosting

- Nessuna compilazione richiesta.
- Diario, profilo, alimenti e dataset importati restano sul dispositivo.
- Database scientifici supportati offline: USDA Foundation, USDA SR Legacy, CIQUAL, FRIDA, CoFID.
- USDA Branded è opzionale online e disattivato di default.
- Prima apertura: serve Internet anche per memorizzare localmente le le librerie JS dell'interfaccia; il service worker prova a conservarle per gli avvii offline successivi.
- Per installazione iPhone/iPad: caricare questo ZIP su un hosting statico HTTPS, aprire l'URL in Safari, Condividi > Aggiungi alla schermata Home.

NOTA: l'hosting contiene soltanto il codice dell'app; i dati personali non sono inclusi nello ZIP e sono salvati nel browser/PWA del dispositivo.

Il pacchetto statico non richiede Node/Next.js: index.html e app.js sono già pronti.
