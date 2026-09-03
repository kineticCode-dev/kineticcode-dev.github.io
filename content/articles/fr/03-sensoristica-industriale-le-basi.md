---
title: "PNP, NPN, numérique, analogique : le langage avec lequel les capteurs parlent à l'automate"
description: "Les bases des capteurs industriels : sorties PNP et NPN, signaux numériques et analogiques (4-20mA, 0-10V), et pourquoi confondre ces concepts est l'erreur de câblage la plus courante."
date: "2026-09-01"
category: "automazione"
tags: ["Sensors", "PLC", "Automation", "Fundamentals"]
---

S'il y a une erreur que, tôt ou tard, commet quiconque travaille sur le terrain — de l'électricien au jeune diplômé en mécatronique, en passant par toi —, c'est de câbler un capteur PNP là où il fallait un NPN, ou l'inverse, et de passer vingt minutes à se demander pourquoi l'automate ne voit absolument rien alors que la LED du capteur clignote joyeusement pour signaler qu'il détecte quelque chose. Ce n'est pas une erreur stupide : elle naît d'un concept subtil, presque toujours mal expliqué, que je veux aujourd'hui t'expliquer une fois pour toutes.

## Un capteur n'est pas un interrupteur, mais il se comporte comme tel

Pars d'une image simple : un capteur de proximité industriel — qu'il soit inductif, capacitif ou photoélectrique, nous les verrons dans le prochain article — fait dans son essence exactement ce que fait un interrupteur mural : il ferme ou ouvre un contact électrique en réponse à quelque chose (dans le cas de l'interrupteur, ta main ; dans le cas du capteur, la présence d'un objet). La différence, c'est que l'interrupteur mural est un bout de métal que tu fermes toi-même mécaniquement, tandis que le capteur contient un petit circuit électronique qui *simule* la fermeture d'un contact en utilisant un transistor comme interrupteur électronique.

Et c'est précisément là que naît la distinction PNP/NPN : elle dépend de **quel côté du circuit le transistor du capteur met en relation avec la sortie**.

## PNP : le capteur "offre" le positif

Un capteur **PNP** (on dit aussi *sourcing*, "qui fournit du courant") relie sa sortie au **+24V** de l'alimentation lorsqu'il est actif. En pratique, quand le capteur détecte l'objet, tu trouves 24V sur la sortie par rapport à la masse. L'entrée de l'automate, de son côté, doit être configurée (ou plus souvent, sur les automates modernes, déjà câblée) pour reconnaître comme "vrai" un niveau haut sur l'entrée, avec la référence 0V reliée en commun.

## NPN : le capteur "aspire" vers la masse

Un capteur **NPN** (dit aussi *sinking*, "qui absorbe du courant") fait exactement l'inverse : lorsqu'il est actif, il relie sa sortie au **0V** (masse). L'entrée de l'automate doit dans ce cas voir un niveau bas comme "vrai", avec le +24V ramené en commun du côté opposé.

![Wiring comparison between a PNP sourcing sensor and an NPN sinking sensor connected to a PLC input](./img/pnp-vs-npn-wiring.svg)

Regarde bien le schéma : la différence physique se trouve entièrement là, dans quelle borne du capteur — celle du signal — est tirée à +24V ou à 0V quand le capteur commute. Si tu câbles un capteur PNP sur une entrée automate câblée pour recevoir du NPN (c'est-à-dire avec le commun à +24V au lieu de 0V), le circuit ne se ferme tout simplement jamais dans le bon sens : l'entrée ne voit aucune variation de niveau utile, et pour l'automate le capteur "n'est jamais actif", même s'il détecte physiquement l'objet à la perfection et que sa LED le confirme.

**Une règle pratique qui te fera gagner du temps sur le terrain :** en Europe, pour des raisons historiques et normatives, la grande majorité des capteurs industriels et des automates est câblée en **PNP**. Sauf indication contraire dans la liste d'E/S ou sur l'étiquette du capteur, pars du principe qu'il s'agit de PNP — mais vérifie toujours, car dans le secteur automobile et dans de nombreuses installations d'origine américaine ou asiatique on trouve encore beaucoup de NPN, et les deux mondes coexistent plus souvent qu'on ne le pense, même au sein d'une même machine.

## Numérique vs analogique : une question différente de PNP/NPN

PNP et NPN concernent *comment* un signal numérique (allumé/éteint, présent/absent) est transporté électriquement. Mais tous les capteurs ne donnent pas une réponse binaire. Beaucoup — pense à un capteur de pression, de température, ou un transducteur de position linéaire — doivent communiquer une **valeur continue** : pas "il y a de la pression" mais "la pression est de 3,7 bar". Pour cela, il faut des signaux **analogiques**, et dans le monde industriel on en trouve essentiellement deux types, presque toujours les mêmes où que tu ailles :

**Courant 4-20mA.** Le capteur fait circuler dans le circuit un courant proportionnel à la grandeur mesurée : 4mA correspond à la valeur minimale de l'échelle (exemple : 0 bar), 20mA à la valeur maximale (exemple : 10 bar). C'est le standard le plus répandu dans l'industrie lourde, et la raison en est élégante d'un point de vue technique : étant un signal en courant et non en tension, il ne subit pas les chutes de tension le long de câbles longs (un problème sérieux quand on parle de dizaines ou de centaines de mètres de câblage dans une usine), et il est immunisé contre la plupart des perturbations électromagnétiques qui affectent en revanche les signaux en tension. Remarque un détail astucieux de la norme : la valeur minimale n'est pas 0mA mais 4mA. Cela permet à l'automate de distinguer une valeur réellement nulle (4mA) d'un câble coupé ou d'un capteur déconnecté (0mA) : un défaut génère une valeur hors échelle reconnaissable au lieu d'une erreur silencieuse qui ressemble à une donnée valide.

**Tension 0-10V.** Conceptuellement plus simple — le capteur génère une tension proportionnelle à la grandeur mesurée —, mais plus sensible aux perturbations et aux chutes de tension sur des câbles longs, donc typiquement réservée aux courtes distances, dans ou près de l'armoire.

Le module d'entrée analogique de l'automate, de son côté, convertit ce signal continu en un nombre numérique via un convertisseur analogique-numérique (CAN), qui te renvoie typiquement une valeur entière sur 12 ou 16 bits à remettre à l'échelle dans ton code sur la grandeur physique réelle — c'est là que dans ton programme tu écris ces fonctions de mise à l'échelle qui transforment `raw_value` en `pressure_bar`, avec la formule linéaire qui relie les deux extrémités de l'échelle.

## NO et NF : l'autre distinction qui compte

Une dernière paire de sigles que tu trouveras partout, et qui est totalement indépendante de PNP/NPN : **NO** (*Normally Open*, normalement ouvert) et **NF** (*Normally Closed*, normalement fermé, souvent noté NC en anglais). Ils décrivent l'état du contact — ou de la sortie électronique équivalente — quand le capteur *n'est pas* actif, c'est-à-dire au repos. Un capteur NO ne laisse passer aucun signal tant qu'il n'a pas détecté l'objet ; un capteur NF fait exactement l'inverse : il laisse toujours passer un signal, sauf quand il détecte l'objet (ou quand il tombe en panne, ce qui en fait un choix très courant dans les circuits de sécurité — si le câble est coupé, le circuit s'ouvre et le système l'interprète correctement comme une alarme, au lieu d'un silence ambigu).

Assemble tous ces sigles — PNP/NPN, NO/NF, numérique/analogique — et tu auras décodé la grande majorité des indications que tu trouves à côté d'un capteur dans un catalogue ou une liste d'E/S : `PNP NO digital`, `NPN NF digital`, `4-20mA analog`. Ce ne sont plus des sigles abstraits : ce sont des instructions de câblage précises, et tu sais désormais exactement quoi faire quand tu les lis.

Dans le prochain article, nous entrons dans le détail des capteurs les plus courants que tu rencontreras physiquement sur le terrain : inductifs, capacitifs, photoélectriques et codeurs — comment ils fonctionnent à l'intérieur, et quand on choisit un type plutôt qu'un autre.
