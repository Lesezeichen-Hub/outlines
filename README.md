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
- ReliefLayers im bestehenden Interface: vorhandene Motivmaske übernehmen oder das editierbare Leuchtturm-Beispiel laden
- Reliefebenen mit Sichtbarkeit, Sperre, Reihenfolge, Farbe, Maskenoperationen, globaler Höhenskala, Kantenprofil und Höhen in Millimetern
- editierbare Vorschlagsmasken aus Helligkeit, Farbähnlichkeit, Kantengrenzen oder zusammenhängenden Flächen ohne automatische Tiefenbehauptung
- numerische Höhenkarte, Tiefenpinsel, Undo/Redo, Isolinien und Querschnitte
- rechnerische Abtragsmenge und einfache, messbare Warnungen zu steilen Wechseln, Reststärke und schmalen Regionen
- drehbare WebGL-Vorschau mit 2D-Canvas-Rückfall, Material- und Lichtwahl, Oberflächenraster, Höhenlinien und verschiebbarer Schnittebene
- Reliefausgabe als Höhenmatrix (JSON, mm), 8-Bit-PNG-Vorschau, SVG, mehrseitiges PDF mit Ebenenblättern und Werkstattangaben, DXF und geschlossenes STL in Millimetern
- Reliefprojekte als `.relief.json` mit Bild- und Maskendaten sowie lokale Speicherung mehrerer Projekte in IndexedDB

## Start

Die Dateien können direkt von einem statischen Webserver ausgeliefert werden:

```powershell
python -m http.server 8080
```

Anschließend `http://localhost:8080/` öffnen. Für den Lesezeichen-Hub den Ordner als statisches Modul mit `index.html` registrieren.

## Architektur

`app.js` steuert Import, vorhandene Konturbearbeitung und die gemeinsamen PDF/DXF-Exporte. `outlines-core.js` erzeugt Motivmasken, Reparaturen und Vektorpfade; `worker.js` verarbeitet Bildaufträge. `relief-core.js` berechnet Ebenen, Höhenkarte, Vorschlagsmasken, Isolinien, Schnitte, Prüfung und STL. `relief-ui.js` verbindet diese Funktionen mit dem bestehenden Interface. `relief-preview.js` rendert das Modell mit WebGL und Canvas-Rückfall. `relief-storage.js` verwaltet lokale Projekte in IndexedDB.

## Tests

```powershell
node tests.mjs
```

Der Browser-Smoke-Test liegt in `relief-smoke.html`. Über einen lokalen Webserver öffnen; er prüft Beispiel, Segmentierung, 3D-Ansicht, Projektspeicherung, Bildimport, Motivübernahme sowie PDF/DXF-Erzeugung und zeigt `PASS` oder einen Fehler an.

## Datenschutz und Grenzen

### ReliefLayers

Im Bereich „Werkart“ ReliefLayers wählen. Bereits geladene Motive werden in Helligkeitsbereiche mit abgestuften Vorschlagshöhen aufgeteilt. Der Regler „Detailtiefe“ bestimmt die Anzahl der vorgeschlagenen Bereiche; wenn ein Bild kaum unterschiedliche Helligkeiten enthält, können es weniger Ebenen sein. Nach manuellen Änderungen bleiben die Ebenen beim Nachberechnen erhalten. Mit „Aktuelles Motiv übernehmen“ lassen sich neue Vorschläge erzeugen. Ohne Bild lässt sich im Reliefbereich das Beispiel „Leuchtturm im Strudel“ laden. Die 3D-Ansicht nutzt dieselbe Höhenkarte wie Höhenlinien und Querschnitte. Eine Fotografie enthält keine verlässlichen Tiefeninformationen; die vorgeschlagenen Höhen müssen für das Werkstück geprüft und angepasst werden.

Die Reliefbearbeitung nutzt eine auf höchstens 320 Pixel Kantenlänge reduzierte Arbeitsauflösung. Das exportierte STL ist ein geschlossenes, auf höchstens 140 Rasterpunkte je Kantenlänge vereinfachtes Modell; STL speichert selbst keine Einheit, die Koordinaten sind Millimeter. Das PNG der Höhenkarte hat 8 Bit je Kanal; für genaue Werte die JSON-Höhenmatrix verwenden. Die lokalen Projekte liegen in IndexedDB des aktuellen Ursprungs. Der Export als `.relief.json` ist die portable Sicherung.

Die Reliefoberfläche bietet Pinsel, Freihand-Lasso, Zauberstab, Farbbereich und Maskenoperationen sowie einfache Segmentierungsvorschläge. Die Auswahlwerkzeuge nutzen die Arbeitsauflösung und erlauben mit Alt das Entfernen aus der Maske. Die Werkzeugprüfung nutzt einen Abstand zur Kontur für schmale Regionen und Engstellen; komplexe Innenwinkel und tatsächliche Zugänglichkeit eines Beitels werden damit nicht garantiert. Der PDF-Assistent erzeugt Gesamtvorlage, Ebenenblätter und Werkstattangaben in A4/A3 mit Kachelung und Kontrollmaß. Die Bildanpassung bietet Einpassen, Zuschneiden und bewusstes Verzerren; bei abweichendem Seitenverhältnis erscheint ein Hinweis. Vor einem handwerklichen Einsatz Druckmaß und Werkstückstärke prüfen.

Alle Bilddaten bleiben im Browser. Der Browser muss das jeweilige Eingabeformat selbst dekodieren können; bei nicht unterstütztem TIFF zeigt Outlines einen verständlichen Hinweis. Sehr große Bilder werden für die interaktive Verarbeitung auf maximal 1200 Pixel Kantenlänge skaliert. Die Exporte werden anschließend in der gewählten physischen Größe und DPI neu gerendert; höhere Export-DPI stellen keine verlorenen Bilddetails wieder her.

## Welches Verfahren passt?

- Foto vor ruhigem Hintergrund: zunächst Laubsäge oder Schnitzen und die automatische Hintergrundfarbe; schwierige Stellen im Original markieren.
- Gleichmäßige Grafik oder Schrift: Dokument mit automatischer Helligkeit. Mit dem manuellen Schwellwert lassen sich helle oder graue Linien gezielt einschließen.
- Fotografiertes Papier mit Schatten: Scan / Foto mit Schatten. Lokalen Umkreis und Empfindlichkeit nur bei Bedarf im Feinbereich ändern.
- Freigestellte Grafik: Transparenz wählen. Dieses Verfahren braucht einen echten Alphakanal.
- Nur Außenform übertragen: Silhouette und Schnittkontur. Bei Schablonen die schwarze Fläche als Ausschnitt behandeln und helle Inneninseln sichern.

Die Erkennung vektorisiert sichtbare Schriftformen, führt aber keine OCR durch. Sie versteht Motive nicht semantisch und garantiert keine fertigungsfähige Konstruktion. Die Werkstattprüfung ist eine geometrische Näherung; sehr dünne, diagonale oder materialabhängig kritische Stege müssen am maßhaltigen Ausdruck geprüft werden. Automatische Inselstege sind auf die 128 größten Inneninseln pro Berechnung begrenzt; verbleibende Löcher werden weiterhin gemeldet.

Manuelle Reparaturen und Pfadänderungen können rückgängig gemacht werden. Neue Erkennungsparameter ersetzen diese Ergebnisänderungen; Motivmarkierungen im Original bleiben erhalten. Zuschneiden, Drehen und Originalwiederherstellung löschen die Markierungen und die Bearbeitungshistorie.
