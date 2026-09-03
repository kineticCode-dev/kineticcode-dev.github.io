---
title: "Pneumatique, deuxième épisode : les électrovannes, où un bit de l'automate devient de l'air en mouvement"
description: "Comment fonctionnent les électrovannes pneumatiques 3/2 et 5/2, la symbolique ISO 1219, et comment l'automate commande vraiment un vérin."
date: "2026-09-01"
category: "automazione"
tags: ["Pneumatics", "Valves", "PLC", "Automation"]
---

Dans l'article précédent, nous avons suivi l'air comprimé du compresseur jusqu'au seuil de la machine, propre, sec et à pression régulée. Nous arrivons maintenant au composant qui relie vraiment ton logiciel au monde physique de la pneumatique : l'**électrovanne** (*solenoid valve*). C'est l'exact équivalent pneumatique du contacteur que tu as rencontré en parlant de l'armoire électrique : une sortie automate à basse puissance (24VDC) commande une bobine, qui à son tour agit sur un mécanisme capable de gérer un débit d'air bien plus important que ce qu'un signal électrique seul pourrait jamais faire.

## Comment ça fonctionne à l'intérieur : un tiroir qui se déplace

Pour simplifier, à l'intérieur d'une électrovanne se trouve un petit élément mobile — une pointeau ou un petit piston, appelé *tiroir* ou *spool* — qui, en se déplaçant de quelques millimètres à l'intérieur du corps de la vanne, ouvre ou ferme différents canaux internes, reliant ou déconnectant les voies d'air. Quand la bobine électrique est excitée, elle génère un champ magnétique qui attire un noyau métallique relié au tiroir, le déplaçant de la position de repos vers la position de travail. Quand la bobine est désexcitée, un élément de rappel — presque toujours un ressort mécanique, ou dans certains cas la pression de l'air elle-même dirigée de façon appropriée (les distributeurs dits à commande pneumatique, ou *pilotés*) — ramène le tiroir à la position de repos.

Ce comportement — repos/travail — est exactement ce que décrit la nomenclature standard des distributeurs, que nous pouvons maintenant décoder : quand tu lis **"distributeur 3/2"** ou **"distributeur 5/2"**, le premier chiffre indique combien d'**orifices** (points de raccordement physiques : alimentation, utilisation, échappement) possède le distributeur, le second chiffre indique combien de **positions** peut prendre le tiroir.

## Le distributeur 3/2 : le choix pour les vérins à simple effet

Un **distributeur 3/2** a trois orifices — typiquement désignés par les lettres **P** (alimentation, *pressure*), **A** (utilisation, vers l'actionneur) et **R** (échappement, *release*, vers l'atmosphère) — et deux positions. En position de repos, il relie A à R (l'utilisation est purgée, sans pression) ; quand la bobine est excitée, il relie P à A (l'utilisation reçoit de l'air sous pression), fermant en même temps R.

Cette configuration est parfaite pour piloter un **vérin à simple effet** : un vérin qui reçoit de l'air comprimé d'un seul côté, et revient en position de repos via un ressort mécanique interne quand l'air est coupé. L'automate ne doit gérer qu'un seul bit : exciter la bobine pour faire sortir le vérin, la désexciter pour qu'il revienne (par gravité ou par le ressort de rappel).

![Comparison between a 3/2-way valve for single-acting cylinders and a 5/2-way valve for double-acting cylinders, with ISO 1219 style symbols](./img/valve-symbols-3-2-5-2.svg)

## Le distributeur 5/2 : le choix le plus courant, pour les vérins à double effet

Beaucoup plus répandu dans l'industrie est le **distributeur 5/2** : cinq orifices (une alimentation P, deux utilisations A et B, deux échappements distincts, souvent désignés R et S) et deux positions. Dans une position, il relie P à A et B à l'échappement ; dans l'autre position (inversée), il relie P à B et A à l'échappement. Le résultat pratique : tu as toujours deux lignes de travail, l'une poussant le vérin dans un sens et l'autre le poussant dans le sens opposé, **toutes deux activement sous pression à tour de rôle** — jamais une poussée de ressort, toujours de l'air.

C'est la configuration typique pour les **vérins à double effet**, où l'air comprimé pousse le piston dans les deux directions (une chambre pour la sortie, une pour la rentrée), sans avoir besoin d'aucun ressort mécanique interne. L'avantage pratique est double : la course de retour est aussi activement contrôlée que celle de sortie (utile si une force est également nécessaire dans le mouvement de rentrée, pas seulement de sortie), et le vérin peut être monté dans n'importe quelle orientation — horizontale, verticale, à l'envers — sans dépendre de la gravité ou d'un ressort pour terminer sa course de retour.

Du point de vue du câblage vers l'automate, un distributeur 5/2 à **bobine simple** (où un ressort mécanique ramène le tiroir en position de repos quand la bobine se désexcite) se commande exactement comme un 3/2 : un seul bit de sortie, un seul état "vrai" pour la sortie et "faux" pour le repos. Mais il existe aussi une variante très répandue, le **5/2 à double bobine** (*bistable*) : il n'a aucun ressort de rappel, et le tiroir conserve sa position même quand les deux bobines sont désexcitées — un détail à l'impact pratique énorme, dont nous parlons dans un instant.

## Monostable vs bistable : un choix aux conséquences réelles sur la sécurité

Si un distributeur est **monostable** (avec une seule bobine et un rappel par ressort), il a un état de repos bien défini : dès que la tension est coupée — même à cause d'une panne, d'une urgence, ou simplement parce que l'automate passe en stop — le tiroir revient toujours à la même position prédéfinie, et avec lui le vérin va dans une position connue et prévisible. Ce comportement est souvent, délibérément, exploité pour la sécurité : si le vérin d'une pince doit *toujours* s'ouvrir en cas d'urgence pour libérer un opérateur, on choisit un distributeur monostable dont le ressort ramène le distributeur à l'état "pince ouverte" par construction, indépendamment du logiciel.

Un distributeur **bistable**, en revanche, conserve la dernière position commandée même en l'absence d'alimentation — propriété précieuse quand un actionneur doit "rester où il était" pendant une coupure (par exemple, un actionneur qui maintient serrée une pièce lourde ne doit pas la relâcher brusquement juste parce que le courant a été coupé), mais qui exige du logiciel un raisonnement plus attentif sur l'état réel de la machine au redémarrage : l'automate, après une coupure de courant, ne peut pas supposer automatiquement dans quelle position se trouve un actionneur bistable — il doit le vérifier avec les capteurs de fin de course (nous en parlons dans le prochain article), pas avec la mémoire de sa dernière commande, qui entre-temps pourrait être complètement obsolète.

## Les îlots de distributeurs : où l'on trouve des dizaines d'électrovannes regroupées

Dans la pratique industrielle réelle, tu trouveras rarement une électrovanne isolée : elles sont presque toujours regroupées dans un **îlot de distributeurs** (*valve island* ou *valve manifold*), un bloc compact qui partage une alimentation d'air commune unique (souvent juste en aval de l'unité FRL vue dans l'article précédent) et, de plus en plus dans les machines modernes, une connexion électrique unique à l'automate via un module de bus de terrain intégré directement sur l'îlot lui-même — au lieu de câbler individuellement chaque bobine jusqu'à l'armoire avec un câble dédié. C'est un avant-goût d'un sujet que nous traiterons plus en détail en parlant des bus de terrain : économiser des dizaines ou des centaines de mètres de câble, en les remplaçant par un seul câble de bus, est l'un des principaux moteurs derrière la décentralisation des E/S dans les machines modernes.

Dans le prochain article, nous bouclons la boucle de la pneumatique en arrivant enfin au composant qui met vraiment l'air en mouvement : les vérins, à simple et double effet, comment ils sont dimensionnés et comment lire une fiche technique réelle.
