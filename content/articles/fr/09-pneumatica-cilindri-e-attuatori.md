---
title: "Pneumatique, troisième épisode : vérins et actionneurs, où l'air devient enfin mouvement"
description: "Comment fonctionnent les vérins pneumatiques à simple et double effet, les capteurs magnétiques de fin de course, le dimensionnement de base et la lecture d'une fiche technique réelle."
date: "2026-09-01"
category: "automazione"
tags: ["Pneumatics", "Cylinders", "Sensors", "Automation"]
---

Nous terminons le bloc consacré à la pneumatique avec le composant le plus visible de tous, celui que n'importe qui, même sans aucune formation technique, reconnaîtrait d'un coup d'œil sur une machine : le **vérin pneumatique**. C'est ici que tout ce que nous avons construit dans les deux articles précédents — l'air traité et régulé, l'électrovanne qui en dirige le flux — se transforme enfin en une véritable poussée mécanique.

## Anatomie d'un vérin : un piston dans un tube

Un vérin pneumatique, dans sa forme la plus courante, est conceptuellement simple : un tube cylindrique (le *corps*), fermé aux deux extrémités par des culasses, à l'intérieur duquel coulisse un piston relié à une tige (*rod*) qui sort par l'une des deux culasses et se relie mécaniquement à la charge à déplacer — une pince, un chariot, un poussoir. L'air comprimé, introduit dans l'une des deux chambres séparées par le piston, pousse ce dernier, générant force et mouvement.

![Cross-section of a double-acting pneumatic cylinder showing air ports A and B, and magnetic proximity sensors mounted on the tie rods](./img/cylinder-cross-section.svg)

Nous avions déjà distingué, en parlant des distributeurs, les vérins à **simple effet** (air d'un seul côté, retour par ressort) et à **double effet** (air actif des deux côtés). Il vaut la peine d'ajouter une considération pratique sur le moment où l'on choisit l'un ou l'autre : le simple effet est plus économique et plus simple à commander, et c'est le choix naturel quand il faut un retour automatique et fiable "par construction" même en l'absence de signal — pense à un mors de sécurité qui doit revenir ouvert dès que l'air ou le courant manque. Le double effet, beaucoup plus répandu en général, est le choix quand il faut un contrôle actif dans les deux directions, une force aussi dans le mouvement de retour, ou quand la course est longue (le ressort d'un vérin à simple effet, au-delà d'une certaine longueur, deviendrait encombrant et avec une force de rappel peu uniforme sur toute la course).

## Les capteurs de fin de course : comment l'automate sait que le vérin est arrivé

Un vérin pneumatique, seul, ne dit pas à l'automate où il se trouve : c'est un actionneur, pas un capteur. Pour savoir si un vérin est complètement sorti ou complètement rentré — une information presque toujours indispensable avant de faire avancer la séquence logique de la machine à l'étape suivante —, il faut des capteurs dédiés, et la solution standard, élégante et presque universelle dans l'industrie, sont les **capteurs magnétiques de proximité** (souvent simplement appelés *capteurs de fin de course magnétiques*, ou par le nom commercial historique *reed switch*, même si la technologie la plus répandue aujourd'hui est à effet Hall).

L'astuce constructive est la suivante : le piston à l'intérieur du vérin porte un anneau magnétique permanent, intégré dans sa structure. Le corps du vérin, quant à lui, n'est pas en matériau ferromagnétique mais en un alliage (typiquement de l'aluminium anodisé) qui laisse passer le champ magnétique sans l'écranter. Les capteurs magnétiques, au lieu d'être montés à l'intérieur du vérin (ce qui nécessiterait un câblage interne complexe et peu fiable), sont fixés **de l'extérieur** sur des rainures de guidage dédiées le long du corps, et détectent le passage du champ magnétique du piston quand celui-ci transite à leur position — sans aucun contact physique, aucun trou dans le corps du vérin, aucun câblage interne. C'est exactement le même principe physique que le capteur inductif déjà rencontré, appliqué dans une configuration spécifique.

L'énorme avantage pratique de ce système est que les capteurs sont **positionnables manuellement**, en les faisant glisser le long de la rainure extérieure du corps et en les bloquant avec une petite vis quand ils sont à la position souhaitée — une opération que tu effectueras concrètement en mise en service, quand tu devras régler avec précision le point exact où l'automate doit considérer comme "atteinte" la position sortie ou rentrée de chaque vérin de la machine.

## Le dimensionnement : combien de force génère vraiment un vérin

Ce n'est habituellement pas ton travail de dimensionner les vérins d'une machine — c'est un travail réalisé par le bureau d'études du fabricant, en phase de conception mécanique, bien avant que tu ne reçoives la liste d'E/S. Mais comprendre le raisonnement de base t'aide énormément à "sentir" si quelque chose ne va pas quand, sur le terrain, un vérin semble trop lent ou incapable de terminer sa course contre une certaine charge.

La force théorique générée par un vérin à double effet en phase de **sortie** se calcule avec une formule très simple, la même logique que la pression hydrostatique que tu as probablement déjà vue ailleurs :

**F = P × A**

où **F** est la force (en newtons), **P** est la pression de l'air (en pascals, ou plus pratiquement convertie à partir des bars), et **A** est la surface du piston sur laquelle l'air pousse (en mètres carrés). Conceptuellement, que dit cette formule ? Que la même pression appliquée sur une surface plus grande génère une force proportionnellement plus grande — c'est pourquoi, à pression de réseau disponible égale (les fameux 6-7 bar vus dans le premier article de cette série), un vérin de diamètre plus grand génère une force plus grande, simplement parce qu'il offre plus de surface à l'air sur laquelle pousser.

Un détail intéressant, et souvent source d'erreurs d'évaluation pour qui n'a jamais fait ce calcul : en phase de **rentrée**, la force est légèrement inférieure à pression égale, parce que la tige qui traverse la culasse "vole" une partie de la surface utile du piston de ce côté — l'air, dans cette chambre, pousse sur une surface en forme de couronne circulaire, pas sur un cercle plein. Pour la plupart des applications, la différence est négligeable, mais dans les catalogues des fabricants (Festo, SMC, Camozzi sont des noms que tu trouveras partout en Europe) tu trouves toujours deux valeurs de force distinctes, une pour la sortie et une pour la rentrée, précisément pour cette raison.

## Un exemple concret de lecture de fiche technique

Imagine devoir vérifier si un vérin SMC série CDQ2, diamètre 32mm, alimenté à la pression de réseau standard de 6 bar, a assez de force pour pousser une charge opposant une résistance estimée à 350N. La fiche technique te donne la surface du piston (pour un diamètre de 32mm, environ 8 cm², soit 0,0008 m²). En appliquant la formule : F = 600 000 Pa × 0,0008 m² ≈ 480N de force théorique. Cela semble suffisant par rapport aux 350N requis — mais voici une dernière considération pratique que tout metteur en service apprend rapidement sur le terrain : la force théorique ainsi calculée est la valeur **statique idéale**, sans tenir compte des frottements internes du vérin, des pertes de charge dans la tuyauterie, et surtout sans aucune marge de sécurité. La règle empirique répandue sur le terrain est de ne pas dépasser, en conditions opérationnelles réelles, environ 70-80 % de la force théorique calculée — dans notre exemple, une marge opérationnelle réelle d'environ 340-380N, déjà assez proche de la limite requise pour te conseiller, au moins en mise en service, un vérin de diamètre supérieur ou une pression de service plus élevée, avant que le problème ne se manifeste en production sous forme d'un cycle trop lent ou d'un vérin qui, avec l'usure, cesse de terminer sa course.

Ceci clôt le bloc sur la pneumatique. Dans le prochain article, nous voyons, par contraste et pour être complets, la grande sœur de la pneumatique quand il faut vraiment de grandes forces : l'hydraulique.
