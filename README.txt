NutriTrace v1.2.1 Local-First + OpenRouter AI — pronto per Vercel

NOVITÀ PRINCIPALI
- Diario realmente giornaliero: ogni registrazione è legata alla data selezionata.
- Navigazione giorno precedente/successivo, date picker e ritorno rapido a “Oggi”.
- Il giorno corrente segue la data locale del dispositivo; al cambio di mezzanotte si aggiorna automaticamente se eri su “Oggi”.
- Totali giornalieri e settimanali calcolati rispetto al giorno/settimana selezionati.
- Eliminazione di singole registrazioni dal diario e di alimenti dall’archivio.
- Rimossi dall’interfaccia i database predefiniti obbligatori e la ricerca USDA online.
- Database locali personalizzati: nome libero, import CSV/XLSX/XLS/ODS/JSON/JSONL e rimozione.
- Parser dedicato ai dataset CREA 2019, inclusi i formati CSV/JSON pubblicamente diffusi.
- Conversione corretta dei valori CREA espressi come % lipidi (acidi grassi) e % proteine (aminoacidi).
- AI integrativa opzionale: crea un alimento mancante o completa esclusivamente i campi mancanti, marcandoli come “AI · stima”.
- Macro in g/kg BW per proteine, carboidrati, grassi, zuccheri e fibre; calorie fisse con P/C/F residuo oppure calorie derivate dai macro.
- Micronutrienti raggruppati per categoria, target assoluto o g/mg/µg per kg BW, giornalieri o settimanali.
- Catalogo esteso: vitamine, minerali/oligoelementi, omega-3/omega-6 e aminoacidi essenziali; restano possibili target personalizzati.

DEPLOY SU VERCEL
Non è richiesta compilazione: index.html/app.js/style.css rimangono statici. La cartella api/ contiene una Vercel Function per l’AI.

Per abilitare l’AI in Vercel aggiungi una Environment Variable:
  OPENROUTER_API_KEY=<chiave API OpenRouter>

Opzionale:
  OPENROUTER_MODEL=openrouter/free

La chiave resta server-side e non viene inclusa nell’app scaricata dal browser.
Senza OPENROUTER_API_KEY tutta l’app continua a funzionare; sono disattivate soltanto le funzioni AI.

OPENROUTER_MODEL è configurabile: il default openrouter/free usa il router gratuito di OpenRouter. In alternativa puoi indicare lo slug di uno specifico modello con variante :free.
Opzionali per l’attribuzione OpenRouter:
  OPENROUTER_SITE_URL=https://nutritrace.vercel.app
  OPENROUTER_APP_NAME=NutriTrace

DATI E PRIVACY
- Diario, profilo, alimenti e database importati restano in localStorage/IndexedDB del browser/PWA.
- Una richiesta verso /api/nutrition-enrich avviene soltanto quando l’utente preme esplicitamente una funzione AI.
- Alla funzione AI vengono inviati il nome dell’alimento, eventuale marca, base in grammi e i valori nutrizionali necessari a non sovrascrivere dati esistenti.

DATABASE CREA ITALIA
NutriTrace v1.2 è predisposto per il dataset CREA – Tabelle di composizione degli alimenti, aggiornamento 2019.
Il CREA non espone nel portale consultato un download ufficiale unico pronto da incorporare nella build; per questo il pacchetto non redistribuisce silenziosamente una copia ottenuta via scraping.

Puoi importare dalla sezione Dati un export CREA in CSV o JSON/JSONL. Il parser riconosce sia le intestazioni italiane sia il formato normalizzato diffuso pubblicamente e conserva i dati offline dopo il primo import.

Fonte da citare per i dati CREA:
CREA Centro di ricerca Alimenti e Nutrizione — Tabelle di composizione degli alimenti, aggiornamento 2019.
https://www.crea.gov.it/alimenti-e-nutrizione
https://www.alimentinutrizione.it

MIGRAZIONE DALLA v1.1
- Diario, alimenti personali, profilo e obiettivi vengono preservati.
- I dataset USDA Foundation/SR e le preferenze USDA online vengono rimossi alla prima esecuzione della v1.2.
- Eventuali CIQUAL/FRIDA/CoFID già presenti vengono mantenuti come normali database locali personalizzati e possono essere rimossi dalla sezione Dati.

INSTALLAZIONE iPHONE/iPAD
Apri il sito HTTPS in Safari > Condividi > Aggiungi alla schermata Home.
La PWA usa la data locale del dispositivo; non richiede accesso al calendario Apple e non crea/modifica eventi.
