"""
Carl-Andreas' training plan - the standard plan the Plan page starts from.

Taken largely from Marius Bakken's book: all quality work (intervals and
continuous runs) at or just under the lactate threshold, three sessions a week
- usually two threshold sessions and one long easy run, plus an optional easy
jog. Weeks are ISO calendar weeks of 2026, the way the plan is written.

THE REPOSITORY IS PUBLIC. Only the workouts and coaching instructions live
here. Anything personal from the original plan - illness, niggles, days off,
where he runs, which races he entered - is deliberately left out; he keeps
that in the app (run notes and edited sessions are encrypted).

Each session: (day, type, title, detail, optional)
  day      mon..sun
  type     easy | long | threshold | race | other
  optional True for the "Evt:"/"Valgfri:" sessions - never counted as missed
Weeks 43-46 are Claude's suggestions, continuing the block; the long runs are
his own progression (97, 105, 110, 120 min).
"""
YEAR = 2026
# Edits he saves in the app remember this. Change it when the plan itself is
# replaced (a new block), so his edits of the old plan do not hide the new one.
VERSION = "bakken-2026-block2"
SUGGESTED = "Forslag fra Claude, i samme stil som blokka - endre fritt."
OPT_JOG = ("sat", "easy", "30–45 min rolig jogg", "", True)

WEEKS = {
    # ---------------- block 1 ----------------
    15: [("sun", "easy", "5 min svært lett jogg + 3×(3 min rask jogg / 90 sek gange) + 5 min svært lett jogg",
          "Rask jogg = roligere enn terskel.", False)],
    16: [("tue", "easy", "5 min svært lett jogg + 3×(3 min rask jogg / 90 sek gange) + 5 min svært lett jogg",
          "Roligere enn første økt, ikke over 170 i puls, helst godt under.", False),
         ("thu", "threshold", "5 min svært lett jogg + 8–10×(45 sek litt under terskel / 30 sek gange) + 5 min svært lett jogg",
          "", False),
         ("sun", "easy", "20 min svært lett jogg",
          "Rolig hele økten, ikke raskere enn oppvarmingen i første økt. Skal ikke kjennes andpusten.", False)],
    17: [("mon", "threshold", "10 min svært lett jogg + 3×(2 min terskel / 2 min lett jogg/gange) + "
          "4×(45 sek terskel / 15 sek gange) + 5 min svært lett jogg", "", False),
         ("wed", "threshold", "10 min svært lett jogg + 8×(90 sek terskel / 90 sek lett jogg/gange) + "
          "6×(45 sek terskel / 15 sek gange) + 5 min svært lett jogg", "", False)],
    18: [("tue", "threshold", "10 min oppvarming + 5×(2 min terskel / 90 sek jogg/gange) + "
          "6×(45 sek terskel / 15 sek gange) + 5 min nedjogg", "", False),
         ("thu", "easy", "30 min kontinuerlig lett jogg", "", False),
         ("sun", "threshold", "15 min oppvarming + 10+5×(45 sek terskel / 15 sek gange) + 5 min nedjogg",
          "Først 10×(45/15) progressivt: øk farten ca. 0,1 km/t for hvert drag - du skal akkurat klare de "
          "2–3 siste. 2 min pause. Deretter 5 nye drag på samme fart som det siste; de vil du typisk akkurat "
          "klare også.", False)],
    19: [("mon", "threshold", "10 min oppvarming + 2×(7 min terskel / 3 min lett jogg/gange) + "
          "4–6×(60 sek terskel / 30 sek gange) + 5 min nedjogg", "", False),
         ("wed", "easy", "35–40 min rolig, eller 25 min rolig + 6×(45 sek terskel / 15 sek gange) + 5 min rolig jogg",
          "Ikke senere enn torsdag i en uke med løp.", False),
         ("sat", "race", "Konkurranse",
          "Ca. 10 min helt rolig oppvarming + noen kontrollerte stigningsløp som del av oppvarmingen.", False)],
    20: [("tue", "threshold", "10 min oppvarming + 2×(8 min terskel / 2 min lett jogg/gange) + "
          "6×(45 sek terskel / 15 sek gange) + 5 min nedjogg", "", False),
         ("thu", "easy", "40 min lett jogg", "", False),
         ("sat", "threshold", "10 min oppvarming + 4×(4 min terskel / 1 min lett jogg/gange) + "
          "8×(45 sek terskel / 15 sek gange) + 5 min nedjogg", "", False),
         ("sun", "easy", "30 min lett jogg", "", True)],
    21: [("tue", "threshold", "10 min oppvarming + 3×(6 min terskel / 2 min pause) + 5–10×(45/15) + 5 min nedjogg",
          "", False),
         ("wed", "easy", "30–35 min lett jogg", "", True),
         ("thu", "threshold", "10 min oppvarming + 15 min sammenhengende terskel + 10 min nedjogg", "", False),
         ("sat", "long", "45 min rolig jogg", "", False),
         ("sun", "easy", "30 min rolig jogg", "", False)],
    22: [("tue", "threshold", "10 min oppvarming + 15 min lavterskel + 5 min rolig jogg + "
          "10×(30 sek terskel / 30 sek gange) + 5 min nedjogg",
          "Du kan ligge på 170–173 i puls på de 15 min sammenhengende - begynn litt lavere. "
          "Opp mot 180 i puls på siste halvdel av 30-sekundersdragene.", False),
         ("thu", "long", "45–50 min lett jogg", "", False),
         ("sat", "threshold", "10 min oppvarming + 4×(5 min terskel / 90 sek pause) + 10×(45/15) + 5 min nedjogg",
          "", False),
         ("sun", "easy", "30–35 min lett jogg", "", True)],
    23: [("tue", "threshold", "10 min oppvarming + 20 min sammenhengende terskel + "
          "10×(30 sek terskel / 30 sek gange) + 10 min nedjogg", "", False),
         ("thu", "long", "50–60 min lett jogg", "", False),
         ("sat", "threshold", "10 min oppvarming + 4×(5 min terskel / 90 sek pause) + 5 min nedjogg", "", False),
         ("sun", "easy", "35 min lett jogg", "", True)],
    24: [("mon", "threshold", "10 min oppvarming + 3×(7 min terskel / 2 min pause) + 5 min nedjogg", "", False),
         ("wed", "easy", "30 min lett jogg", "", True),
         ("fri", "easy", "20 min lett jogg eller hvile", "", True),
         ("sat", "race", "5 km test", "Lørdag eller søndag.", False)],

    # ---------------- block 2 ----------------
    25: [("tue", "easy", "30 min rolig",
          "Lettere uke, maks tre økter. Løp uten å tenke så mye på det - det gjør ikke noe om pulsen går "
          "bittelitt over der den skal ligge på lange rolige turer.", False),
         ("thu", "threshold", "10 min oppvarming + 6×(2 min / 30 sek) + 6×(1 min / 30 sek) + 5 min nedjogg", "", False),
         ("sun", "long", "60 min rolig", "", False)],
    26: [("tue", "threshold", "10 min oppvarming + 3×8 min, p: 2 min + 5 min nedjogg",
          "Terskel/lavterskel - hakket roligere enn 4–6-minuttersintervaller, men hakket mer intensivt enn "
          "sammenhengende tempo.", False),
         ("thu", "threshold", "10 min oppvarming + 15×(45/15) progressivt til litt over terskel + 5 min nedjogg",
          "", False),
         OPT_JOG,
         ("sun", "long", "67 min rolig", "", False)],
    27: [("tue", "threshold", "10 min oppvarming + 2×(8×(60/30)), p: 2 min jogg mellom settene + 5 min nedjogg",
          "", False),
         ("thu", "threshold", "10 min oppvarming + 5×6 min, p: 90 sek + 5 min nedjogg", "", False),
         OPT_JOG,
         ("sun", "long", "75 min rolig", "", False)],
    32: [("tue", "easy", "30 min rolig", "", False),
         ("thu", "easy", "30 min rolig", "", False)],
    33: [("tue", "easy", "30 min rolig + 4 kontrollerte stigningsløp",
          "Stigningsløp: ca. 80 m (to lyktestolper), gradvis økende fart opp mot 70 % av maks - ikke full "
          "spurt, bare for å få litt fart i beina.", False),
         ("thu", "threshold", "20 min rolig + 6×(90 sek løp / 30 sek gange) + 10 min rolig",
          "Halvfort, lavterskel - ikke over 170 i puls. Skal kjennes som om du holder en del igjen.", False),
         ("sun", "long", "50 min rolig", "", False)],
    34: [("tue", "threshold", "10 min oppvarming + 3×5 min, p: 90 sek gange + 10 min nedjogg",
          "Lavterskel, kanskje 167–170 i puls. Du skal oppleve at du holder igjen.", False),
         ("thu", "threshold", "15 min oppvarming + 10×(45/15) + 10 min nedjogg", "Gjerne progressivt.", False),
         ("sat", "easy", "20 min rolig jogg", "", True),
         ("sun", "long", "60 min rolig", "", False)],
    35: [("tue", "threshold", "10 min oppvarming + 2×(6–4–2 min), p: 1 min gange mellom dragene, "
          "2 min veldig rolig jogg mellom settene + 5 min nedjogg",
          "Hold litt igjen fra start på 6- og 4-minutterne - du har bare 1 min pause. Lavterskel på "
          "6 min, terskel på 2 min, 4 min midt imellom.", False),
         ("thu", "easy", "30 min rolig jogg", "", True),
         ("sun", "long", "Rolig langtur", "", False)],
    36: [("tue", "easy", "30 min rolig", "Lettere uke.", False),
         ("thu", "threshold", "10 min oppvarming + 2×(8×(45/15)), p: 1 min mellom settene + 5 min nedjogg",
          "På terskel, eller progressivt til rett over.", False),
         ("sat", "easy", "30–40 min rolig jogg", "", True),
         ("sun", "long", "75 min rolig", "", False)],
    37: [("tue", "threshold", "10 min oppvarming + (7–6–5–4–3–2–1 min), p: 1 min gange + "
          "(40–40–30–30–20–20 sek), p: 20 sek gange + 5 min nedjogg",
          "Relativt kort pause mellom ganske lange drag i starten - avpass farten så du holder gjennom alle. "
          "Farten kan øke gradvis etter hvert som dragene blir kortere.", False)],
    38: [("tue", "threshold", "10 min oppvarming + 4×4 min, p: 1 min + 10 min nedjogg", "Litt lettere uke.", False),
         ("thu", "threshold", "10 min oppvarming + 10×(60/30) + 10×(30/30) + 5 min nedjogg", "", False),
         ("sun", "long", "45 min rolig", "", False)],
    39: [("tue", "threshold", "10 min oppvarming + 5×6 min, p: 90 sek + 5 min nedjogg", "", False),
         ("thu", "threshold", "10 min oppvarming + 20×1 min, p: 30 sek + 5 min nedjogg", "", False),
         OPT_JOG,
         ("sun", "long", "75–80 min rolig", "Uka skriver 75 min, langturstigen din sier 80.", False)],
    40: [("tue", "threshold", "10 min oppvarming + 3×12 min, p: 2 min + 5 min nedjogg", "", False),
         ("thu", "threshold", "10 min oppvarming + 3×(3 min / 1 min) + 3×(2 min / 45 sek) + "
          "3×(1 min / 30 sek) + 5 min nedjogg", "", False),
         OPT_JOG,
         ("sun", "long", "75 min rolig", "", False)],
    41: [("tue", "threshold", "10 min oppvarming + 8×3 min, p: 1 min + 5 min nedjogg", "", False),
         ("thu", "threshold", "10 min oppvarming + 20–25×(45/15) progressivt til litt over terskel + 5 min nedjogg",
          "", False),
         OPT_JOG,
         ("sun", "long", "85 min rolig", "", False)],
    42: [("tue", "threshold", "10 min oppvarming + 30 min tempo (lavterskel) + 5 min nedjogg", "", False),
         ("thu", "threshold", "10 min oppvarming + 10×(60/30) + 10×(30/30) + 5 min nedjogg", "", False),
         OPT_JOG,
         ("sun", "long", "90 min rolig", "", False)],

    # ---------------- suggested continuation (long runs are his own ladder) ----------------
    43: [("tue", "threshold", "10 min oppvarming + 4×8 min, p: 2 min + 5 min nedjogg", "Lavterskel. " + SUGGESTED, False),
         ("thu", "threshold", "10 min oppvarming + 2×(10×(45/15)), p: 2 min + 5 min nedjogg", SUGGESTED, False),
         OPT_JOG,
         ("sun", "long", "97 min rolig", "", False)],
    44: [("tue", "threshold", "10 min oppvarming + 6×5 min, p: 1 min + 5 min nedjogg", SUGGESTED, False),
         ("thu", "threshold", "10 min oppvarming + 3×(3 min / 1 min) + 10×(60/30) + 5 min nedjogg", SUGGESTED, False),
         OPT_JOG,
         ("sun", "long", "105 min rolig", "", False)],
    45: [("tue", "threshold", "10 min oppvarming + 3×10 min, p: 2 min + 5 min nedjogg", SUGGESTED, False),
         ("thu", "threshold", "10 min oppvarming + 20×1 min, p: 30 sek + 5 min nedjogg", SUGGESTED, False),
         OPT_JOG,
         ("sun", "long", "110 min rolig", "", False)],
    46: [("tue", "threshold", "10 min oppvarming + 2×15 min, p: 3 min + 5 min nedjogg", "Lavterskel. " + SUGGESTED, False),
         ("thu", "threshold", "10 min oppvarming + 10×(60/30) + 10×(30/30) + 5 min nedjogg", SUGGESTED, False),
         OPT_JOG,
         ("sun", "long", "120 min rolig", "", False)],
}

# How the plan works - shown on the Plan page. Generic coaching from the plan's
# own introduction, in the app's language.
GUIDE = [
    ("Threshold, not harder",
     "All quality work - intervals and continuous runs - is at or just under the lactate threshold. It lets you "
     "do more quality over time for much less strain than running a little harder. It will feel calmer than you "
     "are used to, and you will not push yourself as much on the intervals. That is the point."),
    ("The talk test",
     "Threshold pace feels comfortably hard: you can say about three words of a sentence - not a whole sentence, "
     "but more than single words. If you can only get out one or two words it is too hard. You will probably "
     "want to go a bit faster than threshold; when in doubt, hold back."),
    ("Easy means easy",
     "Keep the easy runs truly easy, with a low heart rate. That is what lets the threshold work pay off."),
    ("Short on time?",
     "If a week only allows two sessions, drop the easy run and keep both interval sessions - add a longer "
     "warm-up and cool-down to collect some easy kilometres. With just one session, keep the longest interval "
     "session, then repeat that week's plan the next week and shift the rest by a week."),
    ("Never stop completely",
     "In busy periods, keep one run every 7th - or at the very least every 10th - day. Stopping costs continuity "
     "and brings a high risk of injury when you start again."),
    ("Recoveries",
     "The pause can be standing, walking or an easy jog - your choice. Progressive 45/15s are welcome: start a "
     "little under threshold, reach threshold in the middle reps and go slightly over on the last."),
]
