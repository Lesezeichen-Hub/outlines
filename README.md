# Outlines

Outlines ist ein eigenständiges Modul für den Lesezeichen-Hub. Es wandelt Fotos und Grafiken direkt im Browser in Silhouetten, Umrisse, Linienbilder und Schablonen um. Es gibt keine Uploads, keine externen APIs, kein Tracking und keine Laufzeit-Abhängigkeiten.

## Funktionsumfang

- Import von JPG, PNG, WebP, GIF (erstes Bild), BMP, SVG sowie TIFF, wenn der Browser das Format dekodieren kann
- automatische Motivtrennung, Kantenerkennung, morphologische Bereinigung und echte Pfad-Vektorisierung
- fünf wählbare Erkennungsverfahren: Hintergrundfarbe, automatische Helligkeit, manueller Schwellwert, lokale Erkennung bei Schatten und vorhandene Transparenz
- grüne/rote Motivmarkierungen im Original, die beim Ändern der Erkennungsregler erhalten bleiben; reine Vorschauüberlagerung des Originals zum Vergleichen
- aufklappbare Feinsteuerung für Kontrast, lokale Empfindlichkeit, Störpunkte, Lückenschluss und das bewusste Füllen von Innenlöchern
- Werkmodi und Voreinstellungen für Laubsäge, Schnitzen, Brandmalerei und Schablonen
- automatische Schablonenstege, Qualitätswarnungen sowie manuelle Raster- und Pfadkorrekturen
- Schablonenstege sichern helle Inneninseln durch Unterbrechungen im schwarzen Ausschnitt; zusätzliche, getrennte Aktion verbindet bei Bedarf schwarze Formen
- rückgängig machbare Reparaturen für kleine Inseln, Lücken, Innenlöcher, Verstärkung und Ausdünnung
- eigene Außen-Schnittkontur mit Millimeter-Linienstärke in Vorschau, Raster, SVG und PDF; DXF deklariert Millimeter
- Größenangaben in Millimetern, A4/A3, Hoch-/Querformat und mehrseitige PDF-Kachelung
- Export als PNG, JPG, SVG, PDF und DXF
- lokale Verarbeitung in einem Web Worker; Rückfallmodus ohne Worker

## Start

Die Dateien können direkt von einem statischen Webserver ausgeliefert werden:

```powershell
python -m http.server 8080
```

Anschließend `http://localhost:8080/` öffnen. Für den Lesezeichen-Hub den Ordner als statisches Modul mit `index.html` registrieren.

## Tests

```powershell
node tests.mjs
```

## Datenschutz und Grenzen

Alle Bilddaten bleiben im Browser. Der Browser muss das jeweilige Eingabeformat selbst dekodieren können; bei nicht unterstütztem TIFF zeigt Outlines einen verständlichen Hinweis. Sehr große Bilder werden für die interaktive Verarbeitung auf maximal 1200 Pixel Kantenlänge skaliert. Die Exporte werden anschließend in der gewählten physischen Größe und DPI neu gerendert; höhere Export-DPI stellen keine verlorenen Bilddetails wieder her.

## Welches Verfahren passt?

- Foto vor ruhigem Hintergrund: zunächst Laubsäge oder Schnitzen und die automatische Hintergrundfarbe; schwierige Stellen im Original markieren.
- Gleichmäßige Grafik oder Schrift: Dokument mit automatischer Helligkeit. Mit dem manuellen Schwellwert lassen sich helle oder graue Linien gezielt einschließen.
- Fotografiertes Papier mit Schatten: Scan / Foto mit Schatten. Lokalen Umkreis und Empfindlichkeit nur bei Bedarf im Feinbereich ändern.
- Freigestellte Grafik: Transparenz wählen. Dieses Verfahren braucht einen echten Alphakanal.
- Nur Außenform übertragen: Silhouette und Schnittkontur. Bei Schablonen die schwarze Fläche als Ausschnitt behandeln und helle Inneninseln sichern.

Die Erkennung vektorisiert sichtbare Schriftformen, führt aber keine OCR durch. Sie versteht Motive nicht semantisch und garantiert keine fertigungsfähige Konstruktion. Die Werkstattprüfung ist eine geometrische Näherung; sehr dünne, diagonale oder materialabhängig kritische Stege müssen am maßhaltigen Ausdruck geprüft werden. Automatische Inselstege sind auf die 128 größten Inneninseln pro Berechnung begrenzt; verbleibende Löcher werden weiterhin gemeldet.

Manuelle Reparaturen und Pfadänderungen können rückgängig gemacht werden. Neue Erkennungsparameter ersetzen diese Ergebnisänderungen; Motivmarkierungen im Original bleiben erhalten. Zuschneiden, Drehen und Originalwiederherstellung löschen die Markierungen und die Bearbeitungshistorie.
