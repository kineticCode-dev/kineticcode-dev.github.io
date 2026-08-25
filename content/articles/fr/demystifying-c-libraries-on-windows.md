---
title: "Démystifier les bibliothèques C sous Windows : comment inspecter et profiler des fichiers .dll inconnus"
description: "Un guide pratique pour inspecter et profiler des fichiers .dll inconnus dans un environnement Windows."
date: "2026-07-18"
category: "software"
tags: ["C++", "Windows", "DLL", "Débogage"]
---


# Table des matières
1. [Introduction : le problème concret](#introduction-the-real-world-problem)
2. [Le défi : des informations manquantes](#the-challenge-missing-information)
3. [Inspecter et profiler les binaires (.dll et .h)](#inspecting-and-profiling-binaries-dll-and-h)
   1. [Déterminer l'architecture de la bibliothèque](#determining-the-librarys-architecture)
   2. [Identifier le compilateur utilisé](#identifying-the-compiler-used)
4. [Résumé et règles générales](#summary--general-rules)

---

## Introduction : le problème concret
L'idée de cet article part d'un problème bien concret que j'ai rencontré récemment. Nous travaillons en étroite collaboration avec une entreprise partenaire qui nous a fourni plusieurs bibliothèques C, dont nous pensions qu'elles pourraient être utiles pour l'application sur laquelle nous travaillons actuellement. Après une réunion où ils nous ont suggéré les bibliothèques les plus adaptées, ils nous ont envoyé un lot de fichiers `.zip`.

Dans chaque `.zip`, nous avons trouvé :
* Des fichiers d'en-tête (`.h`)
* Des bibliothèques dynamiques compilées (`.dll`)

## Le défi : des informations manquantes
Mon environnement de développement principal est Windows, et j'écris du code C avec Visual Studio Code. J'avais déjà de l'expérience dans l'importation de bibliothèques sous Qt et Visual Studio, mais dans ces environnements-là, en plus des fichiers `.h` et `.dll`, j'avais en général aussi les fichiers d'import `.lib`. Ici, ils manquaient complètement.

Il y a par ailleurs une règle d'or dans le développement en C : dans l'idéal, il faut utiliser pour son projet le même compilateur que celui utilisé pour compiler la bibliothèque fournie.

Tout cela m'a laissé avec pas mal de questions : cette bibliothèque convient-elle vraiment ? Quel compilateur dois-je utiliser ? Et comment, concrètement, importer cette bibliothèque dans Visual Studio Code ?

Essayons de résoudre ça ensemble, étape par étape.

## Inspecter et profiler les binaires (.dll et .h)
La première chose à vérifier, c'est que la `.dll` est compilée pour la même architecture que notre système de développement et notre compilateur.

Si l'on essaie de charger une `.dll` 32 bits dans un exécutable 64 bits, on obtient une erreur au niveau du système d'exploitation (`Bad Image Format, 0xc000007b`). La réciproque est vraie aussi : charger une `.dll` 64 bits dans un exécutable 32 bits produit la même erreur `Bad Image Format`.

### Déterminer l'architecture de la bibliothèque
Pour savoir pour quelle architecture la bibliothèque a été compilée, on peut ouvrir le **Developer Command Prompt for VS22** sous Windows et se déplacer jusqu'au dossier contenant la `.dll` avec la commande `cd`.

Une fois là, on lance la commande suivante dans le terminal :
```cmd
dumpbin /headers your_library_name.dll
```

On recherche la section `FILE HEADER VALUES` dans la sortie. Si l'on trouve :
* **`14C machine (x86)`** : la bibliothèque est en 32 bits.
* **`8664 machine (x64)`** : la bibliothèque est en 64 bits.

![Architecture](/architecture.png)

*(Dans mon cas, la bibliothèque que j'essayais d'importer s'est révélée être en 32 bits.)*

### Identifier le compilateur utilisé
Pour comprendre avec quel compilateur la bibliothèque a été construite, on peut lancer une autre commande depuis le même terminal :
```cmd
dumpbin /dependents your_library_name.dll
```

En analysant la section `Image has the following dependencies:`, on peut déduire le compilateur utilisé :

![Compilateur](/compiler.png)

Si l'on voit des dépendances comme :
* `KERNEL32.dll`
* `msvcrt.dll`
* `libgcc_s_dw2-1.dll`
...alors la bibliothèque a très probablement été compilée avec **MinGW**.

Si l'on voit plutôt des dépendances comme :
* `MSVCRXX.dll` (où XX est un numéro de version)
* `VCRUNTIME140.dll`
* `ucrtbase.dll`
...alors elle a été compilée avec **Microsoft Visual C++ (MSVC)**.

## Résumé et règles générales
Comme règle générale quand on travaille avec des bibliothèques dynamiques sous Windows :

* **Si une bibliothèque a été compilée avec MinGW**, il ne faut généralement que deux fichiers :
  * Le fichier d'en-tête (`.h`)
  * La bibliothèque compilée (`.dll`)
  * *Remarque : l'éditeur de liens de MinGW (`ld`) peut lire directement les symboles à l'intérieur du fichier `.dll`, sans avoir besoin d'un fichier d'import. Cela dit, pour des projets complexes, un fichier d'import comme `.dll.a` peut malgré tout s'avérer nécessaire.*

* **Si une bibliothèque a été compilée avec MSVC**, il faut en général trois fichiers :
  * Le fichier d'en-tête (`.h`)
  * La bibliothèque compilée (`.dll`)
  * Le fichier d'import (`.lib`)

Puisqu'il s'agit ici de bibliothèques à liaison dynamique, n'oublions pas que tous les fichiers `.dll` doivent être placés à côté de l'exécutable, dans le dossier d'installation. Si l'on compilait au contraire de manière statique, le code de la bibliothèque serait directement intégré dans le fichier exécutable.
