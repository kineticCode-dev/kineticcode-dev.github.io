---
title: "Inductif, capacitif, photoélectrique, codeur : quatre façons différentes de faire voir les choses à une machine"
description: "Comment fonctionnent vraiment les capteurs de proximité industriels les plus courants, quand choisir l'un plutôt que l'autre, et comment lire une fiche technique réelle."
date: "2026-09-01"
category: "automazione"
tags: ["Sensors", "Encoders", "Automation", "Fundamentals"]
---

En logiciel, quand tu dois savoir si quelque chose "existe" ou "est dans l'état X", tu écris une condition booléenne et le problème est résolu. Dans le monde physique, savoir si une pièce métallique est arrivée à une certaine position, si un contenant en plastique transparent est plein, ou de combien de degrés un arbre moteur a tourné, sont trois problèmes complètement différents, qui nécessitent trois principes physiques différents pour être résolus de façon fiable. Cet article est le guide des quatre capteurs qui résolvent 90 % des cas que tu rencontreras : inductif, capacitif, photoélectrique et codeur.

![Comparison of inductive, capacitive, photoelectric sensors and a rotary encoder](./img/sensor-types-comparison.svg)

## Le capteur inductif : il ne voit que les métaux, mais il les voit très bien

Le capteur inductif est probablement le capteur de proximité le plus répandu de tous dans l'automatisation industrielle, et la raison en est simple : la plupart des pièces mobiles d'une machine — vérins, chariots, bras — sont en métal, et l'inductif est économique, robuste, sans contact, et pratiquement insensible à la saleté, à l'huile et aux vibrations.

Le principe physique est élégant. À l'intérieur du capteur se trouve une bobine qui génère un champ électromagnétique haute fréquence, qui sort par la face sensible du capteur. Quand un objet métallique entre dans ce champ, des courants induits (dits *courants de Foucault*) s'y créent, absorbant de l'énergie du champ. Le circuit interne du capteur mesure cette absorption d'énergie — en pratique, l'amortissement de l'oscillation de la bobine — et quand elle dépasse un certain seuil, il commute la sortie. Remarque le détail important : **le capteur inductif ne détecte que les matériaux conducteurs**, en pratique presque exclusivement les métaux. Plastique, bois, verre, liquides : pour l'inductif, ils sont transparents, ils n'existent tout simplement pas.

Un paramètre que tu trouveras toujours dans la fiche technique est la **distance nominale de détection** (`Sn`), typiquement quelques millimètres pour les capteurs les plus compacts (les fameux cylindriques M8, M12, M18, où le chiffre indique le diamètre fileté en millimètres) jusqu'à quelques centimètres pour les modèles plus grands. Tu trouveras aussi une distinction entre montage **affleurant (embeddable)** et **non affleurant (non-embeddable)** : les premiers peuvent être encastrés complètement à fleur dans un support métallique sans que cela n'interfère avec la détection, les seconds ont besoin d'un espace libre autour de la face sensible — un détail qui, sur les plans mécaniques du support du capteur, fait vraiment la différence, et qui, s'il est ignoré, produit des capteurs qui "voient" leur propre support au lieu de la pièce à détecter.

## Le capteur capacitif : il voit (presque) tout, même à travers une paroi

Là où l'inductif s'arrête, le capacitif entre en jeu. Il fonctionne de façon conceptuellement similaire — il génère un champ, cette fois électrique et non magnétique, et en mesure la variation — mais il est sensible à la **constante diélectrique** du matériau qui s'approche, une propriété que possède presque tout matériau à un degré ou un autre : plastique, verre, bois, liquides, même la main d'une personne. Cela le rend beaucoup plus polyvalent mais aussi plus "bruyant" : un capacitif mal réglé peut se déclencher à cause de l'humidité de l'air ou de la saleté qui s'accumule sur sa face sensible, donc presque tous les modèles industriels ont un potentiomètre de sensibilité à régler lors de l'installation — l'un des rares capteurs qui nécessite vraiment un réglage sur le terrain, pas seulement un positionnement mécanique.

L'application d'école est la détection de niveau à travers des parois non métalliques : un capteur capacitif placé à l'extérieur d'un réservoir en plastique peut détecter si le liquide à l'intérieur a atteint ce point, sans avoir besoin d'aucun trou dans le réservoir — une solution qui, la première fois qu'on la voit fonctionner, semble presque magique.

## Le capteur photoélectrique : la plus grande portée, le principe le plus intuitif

Le photoélectrique utilise un faisceau lumineux — presque toujours infrarouge, invisible à l'œil mais fonctionnant parfaitement en principe — et en mesure l'interruption ou le reflet. Il en existe trois configurations principales, et il est important de les distinguer car elles changent radicalement la façon dont tu conçois leur montage sur la machine :

**Barrage (through-beam).** Un émetteur et un récepteur séparés, montés face à face : quand quelque chose interrompt le faisceau, le récepteur le détecte. C'est la configuration la plus fiable et à la plus longue portée (même des dizaines de mètres), mais elle nécessite l'alignement et le câblage de deux composants distincts.

**Réflex (retro-reflective).** Émetteur et récepteur dans le même boîtier, avec un réflecteur (un catadioptre passif, économique et sans besoin d'alimentation) monté de l'autre côté : le faisceau part, rebondit sur le réflecteur et revient. Un seul composant actif à câbler, portée intermédiaire.

**Proximité (diffuse).** Le capteur lui-même émet de la lumière et en détecte le reflet direct sur l'objet, sans réflecteur dédié. C'est le plus simple à installer (un seul composant, aucun réflecteur) mais le plus sensible à la couleur et à l'état de surface de l'objet : une surface noire mate reflète beaucoup moins de lumière qu'une surface blanche brillante, et cela peut changer radicalement la portée utile — un détail à bien garder à l'esprit quand la machine doit traiter des produits de couleurs différentes.

## Le codeur : quand savoir "oui ou non" ne suffit pas, et qu'il faut savoir "combien"

Tous les capteurs vus jusqu'ici répondent à une question binaire : présent ou absent. Le codeur répond à une question complètement différente : de combien quelque chose a tourné (ou translaté), et parfois à quelle vitesse. C'est le capteur que tu trouveras sur l'arbre d'un moteur, sur un axe de positionnement, sur toute partie de la machine dont il faut connaître la position exacte et pas seulement quelques états.

Le type le plus courant est le **codeur incrémental optique** : un disque perforé solidaire de l'arbre tournant passe entre un émetteur et un récepteur de lumière, générant un train d'impulsions à chaque passage d'un trou. En comptant les impulsions, l'automate (ou plus souvent un module de comptage rapide dédié, car la fréquence de ces impulsions peut largement dépasser la vitesse de scrutation cyclique normale de l'automate) reconstitue de combien l'arbre a tourné. Les codeurs incrémentaux de qualité ont typiquement deux voies déphasées de 90 degrés (appelées A et B), qui permettent non seulement de compter les impulsions mais aussi de déterminer le **sens** de rotation à partir de la séquence dans laquelle les deux voies commutent — un détail élégant d'ingénierie qui vaut la peine d'être compris, car c'est le même principe utilisé partout où il faut détecter un sens de mouvement à partir de deux signaux numériques déphasés.

L'alternative est le **codeur absolu**, qui, au lieu de compter des impulsions relatives, renvoie directement, à chaque instant, la position absolue actuelle (typiquement sous forme de valeur numérique sur un bus de communication), y compris immédiatement après une mise sous tension — une propriété très précieuse pour les axes qui ne peuvent pas se permettre une phase de "prise d'origine" à chaque redémarrage de la machine, comme les grands axes de positionnement sur une ligne de production continue.

## Lire une fiche technique réelle : quoi chercher en premier

Quand tu reçois un composant physique à mettre en service, ou que tu dois en vérifier un pour un remplacement, la fiche technique du fabricant (Omron, Sick, Balluff, Pepperl+Fuchs sont des noms que tu rencontreras très souvent) a toujours une structure similaire. Les paramètres à regarder en premier, par ordre de priorité pratique : la tension d'alimentation (presque toujours 10-30VDC, avec 24VDC nominal), le type de sortie (PNP/NPN, NO/NF — ce que tu as appris dans l'article précédent), la distance nominale de détection et, pour l'inductif et le capacitif, s'il est affleurant ou non affleurant. Si après avoir lu ces quatre lignes tu sais déjà répondre "ce capteur convient pour cette position sur la machine", tu as appris exactement ce qu'il faut pour travailler en sécurité sur le terrain.

Dans le prochain article, nous passons de "percevoir" à "bouger" : moteurs asynchrones, servomoteurs et variateurs de fréquence, et ce qui change vraiment, du point de vue du logiciel de commande, entre ces trois mondes.
