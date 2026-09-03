---
title: "Courroies, chaînes et vis à billes : comment le mouvement d'un moteur arrive vraiment où il faut"
description: "Le minimum de mécanique de transmission dont a besoin un ingénieur automaticien pour comprendre pourquoi une machine est construite d'une certaine façon."
date: "2026-09-01"
category: "automazione"
tags: ["Mechanics", "Machine Design", "Automation", "Fundamentals"]
---

Un moteur, seul, sait faire une seule chose : faire tourner son propre arbre. Tout le reste — déplacer un chariot en ligne droite, soulever un poids, synchroniser deux axes qui doivent se déplacer dans un rapport fixe l'un par rapport à l'autre — est le travail des **organes de transmission** : les composants mécaniques qui prennent cette rotation et la transforment en autre chose. Ce n'est pas un chapitre de mécanique appliquée au sens académique : c'est, bien plus pragmatiquement, la raison pour laquelle une machine est construite d'une certaine façon, et le savoir t'aide à comprendre, en regardant une machine réelle, pourquoi ce moteur est monté là et relié de cette manière à ce chariot.

![Four common ways to transmit motion: belt and pulley, chain and sprocket, ball screw, and linear guide](./img/mechanical-transmission-types.svg)

## Courroies et poulies : légèreté et silence, avec un compromis

La transmission par courroie est probablement la plus répandue de toutes pour transmettre un mouvement entre deux axes parallèles à courte ou moyenne distance : une courroie (en caoutchouc renforcé, souvent crantée pour éviter le glissement) enveloppe deux poulies, l'une reliée au moteur et l'autre à l'organe à déplacer. Elle est légère, économique, silencieuse, et amortit naturellement les vibrations — une propriété précieuse quand la machine fonctionne à haute vitesse.

Le compromis concerne la précision : même une courroie crantée, aussi rigide soit-elle comparée à une courroie lisse, a une élasticité intrinsèque minime et un jeu dans l'engrènement avec les dents de la poulie. Pour un convoyeur, cela est sans importance. Pour un axe qui doit positionner un outil avec une précision de dixièmes de millimètre, cette élasticité se traduit par une erreur de positionnement qu'un codeur sur le moteur, seul, ne peut pas corriger — parce que le codeur mesure de combien le moteur a tourné, pas de combien la charge à l'autre extrémité de la courroie s'est réellement déplacée. C'est l'une des raisons pour lesquelles, sur les axes de précision les plus critiques, on trouve souvent un second codeur monté directement sur la partie mobile (une configuration appelée *retour direct*, ou *feedback linéaire*), qui referme la boucle de commande sur la position réelle de la charge et non sur celle présumée du moteur.

## Chaînes et pignons : quand il faut de la force sans compromis

Là où la courroie cède la place à la robustesse, on trouve la chaîne : des maillons métalliques articulés qui engrènent sur des roues dentées (les pignons). Contrairement à la courroie, la chaîne est pratiquement inextensible et ne glisse jamais — elle transmet le mouvement avec un rapport de transmission fixe et exact, point par point. C'est le choix typique pour les charges lourdes et les environnements difficiles (saleté, températures élevées, huile) où une courroie en caoutchouc se dégraderait rapidement : chaînes de levage, convoyeurs à chaîne pour palettes et produits lourds, transmissions de puissance sur presses et lignes industrielles robustes.

Le prix de cette robustesse est l'entretien : une chaîne a besoin d'une lubrification périodique et, avec le temps, s'allonge légèrement à cause de l'usure des articulations (phénomène appelé *allongement par usure*), nécessitant un retensionnage périodique — une opération dont, si tu la vois sur le terrain lors d'un arrêt machine programmé, tu sais désormais exactement pourquoi elle est effectuée.

## La vis à billes : la façon élégante de transformer une rotation en translation précise

Quand il faut transformer un mouvement rotatif en mouvement linéaire — non pas simplement transporter quelque chose en cercle, mais déplacer un chariot d'avant en arrière le long d'un axe —, l'organe le plus répandu dans les applications de précision est la **vis à billes** (*ball screw*). Le principe est, en apparence, celui d'une vis ordinaire : un écrou qui avance le long d'un arbre fileté quand celui-ci tourne. La différence substantielle, qui justifie le nom, est qu'entre l'écrou et le filetage de l'arbre il n'y a pas de contact direct glissant, mais une série de billes métalliques qui roulent dans le canal du filetage et sont continuellement recirculées à travers un canal de retour interne à l'écrou.

Pourquoi ce détail est-il important ? Parce que dans une vis traditionnelle le contact est de **glissement** (frottement de glissement), avec des pertes par frottement significatives et une usure dans le temps ; dans la vis à billes le contact est de **roulement** (frottement de roulement), énormément plus efficace — des rendements même supérieurs à 90 %, contre 20-40 % pour une vis traditionnelle —, et avec un jeu mécanique minimal et constant dans le temps. C'est pourquoi pratiquement tous les axes de précision linéaire dans une machine-outil, un système de dosage, une machine d'emballage haut de gamme, utilisent une vis à billes associée à un servomoteur : l'association des deux composants — moteur en boucle fermée plus transmission à jeu très faible — est ce qui rend possible de positionner une charge avec une répétabilité de quelques micromètres.

Un paramètre clé que tu trouveras dans la fiche technique d'une vis à billes est le **pas** (en millimètres par tour) : il définit de combien avance linéairement l'écrou pour chaque tour complet de l'arbre. Avec un moteur dont tu sais exactement de combien il a tourné (grâce au codeur), et un pas connu, le calcul de la position linéaire du chariot devient une simple proportion — la formule que, très probablement, tu trouveras déjà encapsulée dans les fonctions de mise à l'échelle de l'axe dans ton logiciel de contrôle de mouvement.

## Les guides linéaires : la tâche silencieuse de tout garder aligné

Un dernier composant, souvent négligé parce qu'il ne "génère" pas de mouvement mais l'**accompagne**, sont les guides linéaires : des paires de patins qui glissent sur des rails, soutenant la charge et la contraignant à se déplacer exactement dans la direction voulue, sans déviation latérale ou verticale. Ici aussi, la solution la plus répandue dans les applications de précision utilise le roulement sur billes ou galets enfermés dans le patin, pour la même raison que la vis à billes : friction minimale, usure minimale, répétabilité maximale.

Pourquoi est-il important de le savoir, même si ce n'est pas "électrique" et apparemment loin de ton travail ? Parce qu'un axe servo qui vibre, qui n'atteint pas la position demandée avec la précision attendue, ou qui absorbe un courant anormal pendant le mouvement, n'a parfois rien de défectueux dans le logiciel de commande ou dans le réglage du régulateur : le problème est un guide linéaire sale, désaligné ou endommagé, qui introduit un frottement supplémentaire ou une contrainte mécanique que le moteur doit vaincre en plus. Savoir que ce composant existe, et ce qu'il fait, te donne un diagnostic supplémentaire à envisager avant de passer des heures à revoir des paramètres PID qui, en réalité, étaient déjà corrects.

Dans le prochain article, nous entrons dans un monde complètement différent, que tu connais probablement encore moins que le mécanique : la pneumatique, en commençant par comment est produit et traité l'air comprimé qui alimente chaque vérin de la machine.
