---
title: "Les fondamentaux de l'optique industrielle : ce qui compte vraiment quand on choisit un objectif"
description: "Une introduction pratique à l'optique en vision industrielle — champ de vision, distance de travail, profondeur de champ, distance focale, montures, ouverture (F-number) et les compromis qui déterminent si un système d'inspection fonctionne vraiment."
date: "2026-08-18"
category: "automazione"
tags: ["machine-vision", "optics", "vision-systems", "fundamentals"]
---

## Ce que fait vraiment un système optique industriel

Un objectif n'a qu'un seul travail : capter la lumière renvoyée par un objet et en reconstruire une image sur un capteur — généralement un CCD ou un CMOS, les deux technologies qui équipent tous les capteurs d'appareil photo numérique. Votre œil fait exactement la même chose : la cornée et le cristallin courbent la lumière entrante jusqu'à la rétine, et c'est cette courbure qui permet de reconstruire une image. Une caméra industrielle fait exactement pareil, avec un objectif à la place de la cornée et un capteur à la place de la rétine.

Dans un laboratoire ou un projet personnel, un cadrage « à peu près bon » suffit. Dans un système d'inspection industrielle, non. Si vous vérifiez qu'une pièce mécanique respecte une tolérance, ou qu'une étiquette est correctement imprimée, vous devez savoir exactement quelle taille l'objet aura sur le capteur, à quel point il doit être net, et exactement où, dans l'espace, il doit se trouver pour que le système fonctionne tout court. C'est pourquoi une poignée de paramètres, pris ensemble, décrivent complètement le comportement d'un système optique.

## Les paramètres qui définissent un système optique

- **Champ de vision (FoV)** — la zone totale cadrée par l'objectif. Si vous devez inspecter un objet de 5 cm, votre FoV doit être d'au moins 5 cm.
- **Distance de travail (WD)** — la distance entre l'objet et l'objectif à laquelle l'objet est parfaitement net. Ce n'est pas une distance arbitraire : elle est fixée par l'objectif et sa configuration.
- **Profondeur de champ (DoF)** — la plage, devant et derrière le plan de mise au point parfaite, sur laquelle l'objet reste net de façon « acceptable ». C'est l'un des paramètres qui comptent le plus en pratique.
- **Taille du capteur** — la taille physique du capteur, en millimètres, obtenue en multipliant la taille du pixel (typiquement quelques micromètres) par le nombre de pixels.
- **Grandissement** — le rapport entre la taille de l'image sur le capteur et la taille réelle de l'objet. En dessous de 1, le capteur voit moins de détails que la scène réelle ; au-dessus de 1, il zoome effectivement sur un détail.
- **Résolution** — la plus petite distance entre deux points que le système peut encore distinguer comme deux points séparés, plutôt que comme une seule tache floue. Elle dépend à la fois de l'objectif et du capteur, jamais de l'un seul des deux.

Aucun de ces six paramètres n'est indépendant. Ils sont liés par des relations précises, et modifier l'un modifie automatiquement les autres : rapprochez l'objet de l'objectif, et le champ de vision se réduit, le grandissement augmente, et la profondeur de champ diminue. Concevoir un système optique, c'est connaître ces relations assez bien pour les arbitrer délibérément, et non par tâtonnement.

## L'équation des lentilles minces

Pour rendre les calculs abordables, l'optique de base s'appuie sur deux simplifications :

- **Approximation paraxiale** — seuls les rayons entrant dans l'objectif avec un petit angle par rapport à l'axe optique (la ligne imaginaire passant par le centre du système) sont pris en compte. Les rayons frappant les bords avec des angles marqués sont ignorés, ce qui garde la géométrie linéaire.
- **Approximation de la lentille mince** — l'épaisseur physique de la lentille est considérée comme négligeable, si bien que la lentille est modélisée comme un plan unique plutôt que comme un objet solide.

Avec ces deux simplifications, on obtient l'équation sur laquelle repose tout le reste de cet article :

```
1/s' - 1/s = 1/f
```

où `s` est la position de l'objet par rapport à la lentille (négative par convention, puisque l'objet se trouve « avant » la lentille dans le sens de propagation de la lumière), `s'` est la position de l'image (positive), et `f` est la distance focale de la lentille.

Deux autres termes à bien distinguer, parce qu'ils reviennent constamment dans les fiches techniques d'objectifs : la **distance de travail** est la distance entre l'objet et l'avant de l'objectif, tandis que la **distance focale arrière** (back focal distance) est la distance entre l'arrière de l'objectif et le capteur. Ils se situent de part et d'autre de l'objectif — ne les confondez pas.

## La distance focale

Les rayons entrant dans une lentille convergent vers un point unique après avoir été déviés par le verre. La distance entre la lentille et ce point est la distance focale. Dans une lentille convergente (positive), les rayons se rejoignent réellement en un foyer réel. Dans une lentille divergente (négative), les rayons s'écartent après la lentille : il n'y a donc pas de foyer réel, seulement un foyer virtuel — le point d'où les rayons semblent provenir si on les prolonge en arrière.

![Lentille convergente formant un foyer réel, lentille divergente formant un foyer virtuel](./img/focal-length.png)

Tout objectif utilisé en vision industrielle est, dans l'ensemble, un système positif (convergent) : la lumière doit toujours converger sur le plan du capteur, sinon aucune image ne se forme. Un objectif peut contenir des éléments internes à la fois positifs et négatifs pour corriger les aberrations optiques, mais l'assemblage complet reste toujours convergent.

Distance focale et champ de vision évoluent en sens inverse : plus la distance focale est longue, plus le champ de vision est étroit. C'est exactement ce qui se passe quand vous zoomez avec un appareil photo — distance focale plus longue, moins de scène dans le cadre.

Une exception compte particulièrement : quand l'objet se trouve à moins d'environ 10 fois la distance focale, les équations standard des lentilles minces cessent d'être précises. C'est ce qu'on appelle le **mode macro**, et il exige des objectifs spécifiquement conçus pour le travail à courte distance.

## Grandissement et champ de vision

Formellement, le grandissement s'écrit :

```
M = h' / h
```

où `h'` est la taille de l'image sur le capteur et `h` la taille réelle de l'objet. Un objet de 10 mm produisant une image de 5 mm sur le capteur donne M = 0.5.

Une formule liée relie directement la distance de travail à la distance focale et au grandissement :

```
s = f(M - 1) / M
```

Connaissant la distance focale d'un objectif et le grandissement dont vous avez besoin, cette formule indique exactement où placer l'objet — c'est le calcul que l'on fait en dimensionnant un poste de contrôle qualité : on connaît la taille de la pièce, on connaît la taille du capteur, on calcule le grandissement nécessaire, et on en déduit la distance de travail requise.

Il existe aussi une convention de nommage utile à connaître, parce qu'elle indique d'un coup d'œil à quoi un objectif est destiné :

- Les **objectifs macro et télécentriques** sont conçus pour travailler à des distances comparables à leur propre distance focale (« conjugués finis »), et sont classés et vendus selon leur grandissement — « 0.5X », « 1X », « 2X ».
- Les **objectifs à focale fixe** sont conçus pour des distances de travail bien plus grandes que leur distance focale (« conjugués infinis » — pensez aux rayons du soleil, parallèles entre eux), et sont classés et vendus selon leur distance focale — « 8mm », « 25mm », « 50mm ».

Si un objectif est annoncé comme « 2X » plutôt que « 50mm », vous savez déjà qu'il appartient à la première famille : conçu pour travailler de près, sur de petits détails. Un objectif « 25mm » appartient à la seconde famille : conçu pour travailler à distance, comme un objectif photographique ordinaire.

## Montures et distance focale de bride

Avant d'aller plus loin dans l'optique, il y a une question mécanique tout aussi importante : comment un objectif se fixe-t-il physiquement à une caméra ? La distance entre la bride de fixation et le capteur — la **distance focale de bride** (flange focal distance) — intervient dans tous les calculs optiques vus plus haut. Si elle est mal réglée, l'équation des lentilles minces cesse de correspondre à la réalité : l'image ne sera pas nette là où elle devrait l'être.

| Mount | Distance focale de bride | Remarques |
|---|---|---|
| C-mount | 17.526 mm | La monture la plus courante dans les caméras industrielles. Diamètre 1 pouce, 32 filets par pouce. |
| CS-mount | 12.526 mm | 5 mm plus courte que le C-mount. Un objectif C-mount sur une caméra CS-mount (ou l'inverse) place le capteur à la mauvaise distance et l'image ne sera pas nette. |
| F-mount | Baïonnette (insertion puis rotation) | Développée par Nikon, utilisée pour les capteurs plus grands. Contrairement aux autres, la distance focale arrière n'est pas ajustable sur cette monture. |
| Monture Mxx (ex. M42, M72) | Variable | Une famille de montures filetées définies par leur diamètre, leur pas de filetage et leur distance focale de bride — utilisées pour des capteurs encore plus grands que le F-mount. |

Quand on choisit un objectif pour une caméra donnée, la première question mécanique est toujours « quelle monture utilise ma caméra ? » — se tromper de monture, et soit on ne peut tout simplement pas fixer l'objectif, soit on le fixe à la mauvaise distance et rien de ce qui suit n'a plus d'importance.

Même avec une monture correctement assortie, les caméras réelles atteignent rarement la distance focale de bride nominale exactement — le verre de protection qui couvre le capteur a sa propre épaisseur, et la lumière qui le traverse déplace légèrement le point de mise au point effectif. C'est pourquoi les fabricants d'objectifs vendent des **kits de cales** (shim kits) : de fines entretoises utilisées, en particulier avec les objectifs télécentriques, pour ajuster finement la distance réelle jusqu'à sa valeur optimale. Ce n'est pas un détail mineur — sur un objectif télécentrique, une erreur de quelques dixièmes de millimètre sur la distance focale arrière peut modifier de façon perceptible le grandissement mesuré, ce qui compte énormément si l'objectif sert à une mesure dimensionnelle plutôt qu'à simplement « voir » la pièce.

## Formats de capteurs

Deux tableaux de référence reviennent constamment quand on spécifie un système de vision : l'un pour les capteurs **line scan** (qui capturent l'image une rangée de pixels à la fois — typique des lignes de production où l'objet défile sous la caméra), l'autre pour les capteurs **area scan** (le type le plus courant, qui capture une image complète d'un coup, comme un appareil photo ordinaire).

**Capteurs line scan (longueur en pixels d'une seule rangée)**

| Résolution × taille de pixel | Longueur du capteur |
|---|---|
| 2048 px × 10 µm | 20.5 mm |
| 2048 px × 14 µm | 28.6 mm |
| 4096 px × 7 µm | 28.6 mm |
| 4096 px × 10 µm | 41 mm |
| 6144 px × 7 µm | 43 mm |
| 8192 px × 7 µm | 57.3 mm |
| 12288 px × 5 µm | 62 mm |

**Capteurs area scan (formats standards)**

| Format | Largeur | Hauteur | Diagonale |
|---|---|---|---|
| 1/3″ | 4.8 mm | 3.6 mm | 6.000 mm |
| 1/2.5″ | 5.76 mm | 4.29 mm | 7.182 mm |
| 1/2″ | 6.4 mm | 4.8 mm | 8.000 mm |
| 1/1.8″ | 7.176 mm | 5.319 mm | 8.933 mm |
| 2/3″ | 8.8 mm | 6.6 mm | 11.000 mm |
| 1″ | 12.8 mm | 9.6 mm | 16.000 mm |
| 4/3″ | 18.8 mm | 13.5 mm | 22.500 mm |
| Full frame 35 mm | 36.0 mm | 24.0 mm | 43.300 mm |

Un point qui mérite d'être souligné, parce qu'il piège presque tous les débutants : ces appellations en « pouces » sont historiques, pas physiques. Un capteur « 1/3 de pouce » a une diagonale de 6 mm, pas 8.47 mm comme le suggérerait un calcul littéral d'un tiers de pouce. Cette dénomination remonte aux caméras à tube à vide des années 1950, où le *diamètre extérieur du tube de verre* faisait, approximativement, un pouce — alors que la zone photosensible utile était bien plus petite que le tube lui-même. Quand les capteurs CCD à semi-conducteurs sont arrivés dans les années 1980-90, les fabricants ont conservé la dénomination en « pouces » pour des raisons de compatibilité commerciale, même si elle ne correspond plus directement à aucune dimension physique. Ne déduisez jamais la taille réelle d'un capteur de son appellation en pouces par un calcul direct — vérifiez toujours les valeurs en millimètres dans la fiche technique.

Il est également utile de savoir que deux caméras partageant le même « format » nominal peuvent avoir des capteurs sensiblement différents, parce que le rapport largeur/hauteur peut varier d'un modèle à l'autre. Quand vous choisissez un objectif pour une caméra donnée, vérifiez les dimensions réelles du capteur en millimètres — ne vous fiez jamais au seul format nominal.

## Ouverture (F-number) et profondeur de champ

C'est la partie la plus dense du sujet, et aussi la plus concrète : à quel point un objectif est « ouvert » ou « fermé », et ce que cela change.

### Le F-number

L'ouverture d'un objectif — la taille du « trou » par lequel passe la lumière, exactement comme la pupille de votre œil qui se dilate ou se contracte — s'exprime par le F-number, défini dans des conditions standard comme :

```
F/# = f / d
```

où `d` est le diamètre de l'ouverture et `f` la distance focale. C'est contre-intuitif au premier abord : un F-number **plus élevé** signifie une ouverture **plus petite**, parce que `d` se trouve au dénominateur. F/16 est une ouverture bien plus petite que F/2.

Les valeurs standard que l'on trouve sur tout objectif sont F/1.0, F/1.4, F/2, F/2.8, F/4, F/5.6, F/8, F/11, F/16, F/22. Chaque cran vers le haut (ouverture plus petite) **divise par deux** la quantité de lumière qui entre dans l'objectif.

![Taille de l'ouverture diminuant de F/2 à F/8 puis F/16](./img/aperture-fnumber.png)

Pour les objectifs macro ou télécentriques (la famille à conjugués finis décrite plus haut), on utilise une variante corrigée, le **working F-number** :

```
wF/# = (1 + M) × F/#
```

Cette correction tient compte du fait que, lorsque l'objet est proche (comme c'est le cas avec ces objectifs), le grandissement lui-même modifie le comportement effectif de l'ouverture, la rendant plus « fermée ».

### Profondeur de champ

On peut maintenant définir précisément la profondeur de champ : c'est la plage comprise entre le point le plus proche et le point le plus éloigné où un objet reste net de façon acceptable.

Il y a une subtilité qui mérite qu'on s'y arrête : physiquement, il existe exactement un seul plan, dans l'espace objet, parfaitement conjugué au plan du capteur — un unique plan qui produit une image mathématiquement parfaite. Tout ce que l'on appelle « profondeur de champ » relève en réalité d'une question d'*acceptabilité*, pas de perfection : la quantité de flou encore « acceptable » dépend entièrement de l'application. Un contrôle dimensionnel de précision (mesurer une pièce au centième de millimètre près) exige bien plus de netteté qu'une inspection visuelle générique (vérifier simplement qu'une étiquette est présente et lisible).

![Profondeur de champ comme zone autour d'un unique plan parfaitement net](./img/depth-of-field.png)

Une formule pratique pour estimer la profondeur de champ :

```
DoF [mm] = wF/# × p[µm] × k / M²
```

où `p` est la taille du pixel du capteur en micromètres, `M` le grandissement de l'objectif, et `k` un facteur sans dimension, dépendant de l'application — typiquement **0.008** pour les applications de mesure dimensionnelle (où la netteté compte le plus) et **0.015** pour les applications d'inspection de défauts (où un peu plus de tolérance est acceptable).

**Exemple chiffré.** Grandissement de l'objectif M = 0.25X, working F-number wF/# = 8, taille de pixel du capteur p = 5.5 µm, application d'inspection de défauts, donc k = 0.015.

1. M² = 0.25 × 0.25 = 0.0625
2. numérateur : wF/# × p × k = 8 × 5.5 × 0.015 = 0.66
3. DoF = 0.66 / 0.0625 = 10.56 mm ≈ **10.5 mm**

Une petite précision honnête sur les unités : la taille de pixel dans cette formule est en micromètres, alors que le résultat est donné directement en millimètres — un saut de trois ordres de grandeur que la formule n'explicite pas. En pratique, la constante `k` intègre presque certainement à la fois un facteur de conversion dimensionnelle et un critère empirique de flou acceptable, calibré sur des essais réels plutôt que dérivé de premiers principes. Cela ne rend pas la formule fausse — les chiffres sont cohérents — mais il vaut la peine de savoir que c'est un raccourci d'ingénieur, pas une dérivation rigoureuse, pour éviter de vouloir la retrouver soi-même et de croire à une erreur quand vos propres calculs ne la reproduisent pas exactement.

Sur le choix du F-number : F/8 est un compromis courant. Les ouvertures plus petites (F-numbers plus élevés, comme F/16 ou F/22) commencent à souffrir de **diffraction** — un effet d'optique ondulatoire où la lumière se disperse quand l'ouverture devient très petite, ce qui, paradoxalement, dégrade la netteté alors même que la profondeur de champ continue d'augmenter. Les ouvertures plus grandes (F-numbers plus bas, comme F/1.4 ou F/2) sont plus sujettes aux **aberrations optiques et à la distorsion**, des imperfections inhérentes à toute conception d'objectif qui deviennent plus visibles à pleine ouverture.

Le compromis sous-jacent mérite d'être bien intégré : une petite ouverture (F-number élevé) demande plus de lumière mais offre plus de profondeur de champ et moins d'aberrations ; une grande ouverture (F-number bas) demande moins de lumière mais offre moins de profondeur de champ et plus d'aberrations/distorsion. Il n'existe pas d'ouverture universellement « correcte » — F/8 est un choix par défaut raisonnable, mais le bon choix dépend toujours de la lumière réellement disponible et de la profondeur de champ dont l'application a besoin, par rapport à la netteté maximale recherchée.

## Quatre autres termes à connaître

Une poignée de concepts reviennent constamment autour de l'optique industrielle sans toujours être expliqués en détail :

- **MTF (Modulation Transfer Function, fonction de transfert de modulation)** — la manière standard de mesurer objectivement à quel point un objectif est « net », à différents niveaux de détail. Plutôt que de dire qu'un objectif est « net » en termes généraux, la MTF indique numériquement à quel point le système reproduit le contraste entre des lignes de plus en plus fines — c'est l'outil que les fabricants utilisent réellement pour comparer rigoureusement la qualité des objectifs.
- **Télécentricité** — un objectif normal (« entocentrique ») fait paraître les objets plus petits à mesure qu'ils s'éloignent, exactement comme la perspective humaine. Un objectif **télécentrique** est spécifiquement conçu pour supprimer cet effet sur une certaine plage de distance : un objet mesure la même taille dans l'image, quel que soit l'endroit précis où il se trouve dans la profondeur de champ. C'est pourquoi les objectifs télécentriques sont le choix standard pour la mesure dimensionnelle de précision, où une petite erreur de positionnement ne doit surtout pas se traduire par une erreur de mesure.
- **Optique péricentrique** — une troisième famille, moins courante, conçue pour imager les surfaces internes d'un objet creux (l'intérieur d'un tube, par exemple) selon un point de vue légèrement incliné plutôt que de face.
- **Distorsion** — une déformation géométrique de l'image par rapport à la réalité : des lignes droites de la scène réelle apparaissent courbes dans l'image (distorsion en barillet, qui courbe vers l'extérieur ; distorsion en coussinet, qui courbe vers l'intérieur). C'est un défaut qui compte pour les applications de mesure et qui, si nécessaire, se corrige par logiciel, parce qu'il affecte directement la précision de toute mesure dimensionnelle prise sur l'image.

## Comment tout cela s'articule

1. La **distance focale (f)**, combinée à la distance de l'objet, détermine où l'image se forme (l'équation des lentilles minces) et quelle est la taille du **champ de vision (FoV)**.
2. Le rapport entre la taille de l'image et la taille réelle de l'objet définit le **grandissement (M)**, qui détermine à son tour la **distance de travail (WD)** dont un objectif donné a besoin.
3. Le **diamètre de l'ouverture**, rapporté à la distance focale, donne le **F-number** — qui contrôle à la fois la quantité de lumière qui entre et, combiné au grandissement et à la taille de pixel, la taille de la **profondeur de champ (DoF)**.
4. Tout cela doit se réconcilier avec la mécanique : la **monture** et la bonne **distance focale arrière** déterminent si le plan où l'image « devrait » se former coïncide réellement avec le plan physique du capteur.
5. Enfin, la manière dont tout cela se traduit en une image réellement utile dépend aussi de la **résolution, de la MTF, de la télécentricité et de la distorsion** — des facteurs qui vont au-delà des paramètres de base mais comptent tout autant dans un système réel.

Si vous ne deviez creuser que deux fils conducteurs, ce seraient la télécentricité et la MTF. Ce sont les concepts le plus souvent mentionnés en passant, et pourtant ils sont centraux dans toute application industrielle réelle impliquant de la mesure ou du contrôle qualité — bien les comprendre est ce qui rend une fiche technique d'objectif réellement lisible.
