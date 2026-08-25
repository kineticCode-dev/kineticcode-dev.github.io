---
title: "Comment démarrer automatiquement un programme sous Windows"
description: "Vous avez un programme que vous aimeriez voir s'ouvrir automatiquement à chaque démarrage de votre ordinateur ? Dans ce court guide, nous allons voir comment faire ça rapidement et facilement grâce à un outil intégré à Windows, le Planificateur de tâches."
date: "2026-07-18"
category: "software"
tags: ["Windows"]
---

# Table des matières
1. [Introduction](#introduction)
2. [Guide étape par étape](#step-by-step-guide)
3. [Conclusion](#conclusion)

---

## Introduction
Parfois, surtout quand on a développé son propre logiciel ou qu'on utilise une application précise tous les jours, c'est bien pratique de la faire démarrer automatiquement dès qu'on se connecte à Windows. Pas besoin d'installer un quelconque logiciel externe pour ça : Windows dispose déjà d'un outil parfait, prêt à l'emploi, le Planificateur de tâches (Task Scheduler).

## Guide étape par étape

Suivez ces quelques étapes simples pour configurer le démarrage automatique de votre programme :

1. **Ouvrez le Planificateur de tâches** : ouvrez le menu Démarrer de Windows et recherchez "Planificateur de tâches" (Task Scheduler). Cliquez dessus pour lancer l'application.
2. **Créez une tâche de base** : regardez le panneau situé à droite de la fenêtre et cliquez sur **"Créer une tâche de base..."**.
3. **Donnez un nom à votre tâche** : donnez à votre tâche un nom clair (par exemple "Démarrer mon logiciel Qt") puis cliquez sur **Suivant**.
4. **Choisissez le déclencheur** : comme déclencheur, sélectionnez **"Lors de l'ouverture de session"** (ou "Au démarrage de l'ordinateur", si vous préférez) puis cliquez sur **Suivant**.
5. **Choisissez l'action** : sélectionnez **"Démarrer un programme"** comme action puis cliquez sur **Suivant**.
6. **Sélectionnez votre programme** : cliquez sur **"Parcourir..."** et repérez le fichier exécutable original (généralement un fichier `.exe`) de votre programme. Sélectionnez-le puis cliquez sur **Suivant**.
7. **Terminez** : vérifiez vos réglages puis cliquez sur **Terminer**.

Et voilà ! Votre programme est désormais programmé pour démarrer automatiquement.

## Conclusion
Utiliser le Planificateur de tâches de Windows est une manière sûre et propre de gérer les programmes qui démarrent en même temps que votre ordinateur. Vous pouvez toujours revenir à la liste du Planificateur de tâches pour supprimer ou modifier cette tâche si vous changez d'avis plus tard.
