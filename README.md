# Outlines

Outlines ist ein eigenständiges Modul für den Lesezeichen-Hub. Es wandelt Fotos und Grafiken direkt im Browser in Silhouetten, Umrisse, Linienbilder und Schablonen um. Es gibt keine Uploads, keine externen APIs, kein Tracking und keine Laufzeit-Abhängigkeiten.

## Funktionsumfang

- Import von JPG, PNG, WebP, GIF (erstes Bild), BMP, SVG sowie TIFF, wenn der Browser das Format dekodieren kann
- automatische Motivtrennung, Kantenerkennung, morphologische Bereinigung und echte Pfad-Vektorisierung
- Werkmodi und Voreinstellungen für Laubsäge, Schnitzen, Brandmalerei und Schablonen
- automatische Schablonenstege, Qualitätswarnungen sowie manuelle Raster- und Pfadkorrekturen
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

Alle Bilddaten bleiben im Browser. Der Browser muss das jeweilige Eingabeformat selbst dekodieren können; bei nicht unterstütztem TIFF zeigt Outlines einen verständlichen Hinweis. Sehr große Bilder werden für die interaktive Verarbeitung auf maximal 1800 Pixel Kantenlänge skaliert. Die Exporte werden anschließend in der gewählten physischen Größe und DPI neu gerendert.
