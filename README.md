# ESC-Winner-Song-Voting

Kleine Web-App, mit der das Publikum den Winner-Song wählt.

| Seite | URL | Für wen |
|---|---|---|
| Abstimmen | `/` | Publikum (Smartphone, via QR-Code) |
| Leaderboard | `/leaderboard` | Beamer / Leinwand |
| Admin | `/admin` | Organisation (passwortgeschützt) |

- Eine Stimme pro Browser (Cookie + localStorage), kein Login.
- Resultate bleiben geheim, bis der Admin auf **«Gewinner enthüllen»** klickt. Erst dann liefert der Server die Zahlen aus.
- Daten werden in `data/data.json` gespeichert und überleben einen Neustart.

## Starten

Benötigt Node.js 18 oder neuer.

```bash
npm install
ADMIN_PASSWORD=geheim PORT=3000 npm start
```

Unter Windows (PowerShell): `$env:ADMIN_PASSWORD="geheim"; npm start`

Ohne `ADMIN_PASSWORD` gilt das Standardpasswort `harmonie`. Für den Konzertabend unbedingt ein eigenes setzen.

Umgebungsvariablen: `PORT` (Standard 3000), `ADMIN_PASSWORD`, `DATA_FILE` (Standard `data/data.json`).

## Ablauf am Konzert

1. **Vorher:** Unter `/admin` die Songs erfassen. Unter *Einstellungen* die öffentliche URL eintragen, damit der QR-Code auf dem Leaderboard stimmt.
2. **Beamer:** `/leaderboard` öffnen, einmal auf **«Ton aktivieren»** klicken (Browser erlauben Ton erst nach einem Klick), dann **F** für Vollbild.
3. **Voting öffnen**: Der Beamer zeigt QR-Code und Live-Zähler der Stimmen (ohne Zwischenstand).
4. **Voting schliessen**, dann **«Gewinner enthüllen»**. Das Leaderboard startet automatisch die Show: nur die Top 3 werden von hinten aufgedeckt (die übrigen Plätze bleiben auf dem Beamer geheim und sind nur im Admin sichtbar), Trommelwirbel, Gewinner mit Konfetti. Bei Gleichstand werden alle Erstplatzierten gezeigt.

Tasten auf dem Leaderboard: **F** Vollbild · **R** Enthüllung wiederholen · **B** zwischen Top 3 und Gewinner wechseln.

Mit «Enthüllung zurücknehmen» kehrt das Leaderboard zum QR-Code zurück, und «Alle Stimmen löschen» setzt das Voting für eine Probe zurück. Der Browser vergisst dabei auch seine alte Stimme.

## Hosting

Die Smartphones müssen den Server erreichen. Möglichkeiten:

- **Im Internet** (empfohlen): auf einem beliebigen Node-Hoster (z.B. Render, Fly.io, Railway oder einem eigenen VPS) mit HTTPS. Auf ein persistentes Volume für `DATA_FILE` achten.
- **Lokal im Saal**: Laptop und Publikum im selben WLAN. `npm start` auf dem Laptop und als öffentliche URL `http://<Laptop-IP>:3000/` eintragen.

Hinweis: «Eine Stimme pro Browser» ist bewusst einfach gehalten. Wer Cookies löscht oder einen zweiten Browser nutzt, kann nochmals abstimmen. Für ein Winner-Song-Voting reicht das.
