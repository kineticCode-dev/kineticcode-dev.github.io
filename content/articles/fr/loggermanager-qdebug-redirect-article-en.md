---
title: "Rediriger les qDebug de Qt vers un fichier sans recompiler : la classe LoggerManager"
description: "Un plantage sur le terrain que je n'arrivais pas à diagnostiquer, aucun moyen de recompiler sur place, et la classe C++/Qt que j'ai écrite pour capturer les logs à l'exécution — avec chaque erreur d'édition de liens rencontrée en chemin."
date: "2026-08-05"
category: "software"
tags: ["cpp", "qt", "debogage", "outillage"]
---

## Le problème, sur le terrain

Une application Qt en C++, déjà compilée et installée sur la machine d'un client, s'était mise à planter. Aucune sortie, absolument rien : l'exécutable avait été compilé sans `console` dans le fichier `.pro`, si bien que chaque ligne de `qDebug()` disparaissait purement et simplement à l'instant où l'application se fermait.

La solution rapide, tout développeur Qt la connaît : ajouter `CONFIG += console` au fichier `.pro`, recompiler, lancer depuis un terminal et lire la sortie de `qDebug()` en direct pendant que l'application plante. Ça a marché, mais ça m'a laissé avec une question gênante : et si je ne pouvais pas recompiler ? Un client n'attend pas que vous prépariez une build de debug et la lui envoyiez — il veut le fichier de log de ce qui tourne déjà, là, maintenant, sur sa machine.

C'est de là qu'est venue l'idée : une petite bibliothèque qui intercepte chaque `qDebug()`, `qWarning()`, `qCritical()` d'une application Qt et les écrit dans un fichier, activable et désactivable à l'exécution, sans toucher au code existant ni recompiler quoi que ce soit.

[Dépôt](https://github.com/kineticCode-dev/qDebugRedirection)

## La contrainte de conception

Pour être réellement utile sur un projet déjà existant, la solution devait respecter deux conditions :

- **un impact quasi nul sur le code du projet hôte** : inclure un header et ajouter deux lignes dans `main`, rien de plus.
- **aucune recompilation pour activer ou désactiver le logging** : le comportement doit être pilotable depuis l'extérieur, via des variables d'environnement.

Qt nous donne déjà le bon point d'accroche pour ça : `qInstallMessageHandler()`. C'est une fonction de niveau système conçue pour intercepter *chaque* message du framework (`qDebug`, `qWarning`, `qCritical`, `qFatal`) et le rediriger où l'on veut, avant même qu'il n'atteigne la console.

## Le premier piège : les callbacks à la C n'ont pas de `this`

Le premier prototype était une simple fonction libre passée à `qInstallMessageHandler`. Ça fonctionnait, mais ce n'était pas propre : je voulais l'encapsuler dans une classe, pour pouvoir écrire simplement, dans `main`,

```cpp
LoggerManager lm;
lm.init();
```

plutôt que de laisser flotter une fonction nue dans le scope global. C'est là qu'est apparue la première contrainte technique non évidente : `qInstallMessageHandler` attend un pointeur de fonction avec une signature fixe,

```cpp
void (*)(QtMsgType, const QMessageLogContext &, const QString &)
```

Une méthode d'instance normale possède un paramètre supplémentaire caché sous le capot : le pointeur `this`. Les deux signatures ne correspondent pas, et le compilateur ne convertit pas une méthode d'instance en ce type de pointeur de fonction. Pour ce genre de crochet système, Qt s'appuie encore sur de bons vieux pointeurs de fonction à la C, sans wrapper comme `std::function` ni lambda capturante.

Conséquence pratique : `messageHandler` doit rester `static` (ou être une fonction libre en dehors de la classe), et par conséquent, tout état lu par cette fonction — dans notre cas, le nom du fichier de log — doit lui aussi être `static`. `init()`, en revanche, peut rester une méthode d'instance normale : c'est là que le chemin est construit, que les variables d'environnement sont lues, et que la décision d'installer le handler est prise.

## Le deuxième faux pas : LNK2019

Une fois la classe réécrite, la build échouait avec un classique `LNK2019: unresolved external symbol` sur le membre statique `m_fileName`. La raison : en C++ (jusqu'à C++17), déclarer un membre `static` dans le header déclare seulement qu'il *existe*, sans allouer de mémoire pour lui. Il faut une ligne de définition explicite dans le fichier `.cpp` :

```cpp
QString LoggerManager::m_fileName = "app_debug.log";
```

Un détail de manuel, mais c'est exactement le genre d'erreur qu'on ne prend au sérieux qu'une fois qu'on l'a vue surgir dans l'éditeur de liens sur un vrai projet, pas dans un tutoriel.

## L'activer à l'exécution, sans fichier `.ini`

Pour éviter de dépendre d'un fichier de configuration externe — qui, dans un déploiement industriel, pourrait manquer, être écrasé, ou se retrouver en lecture seule — j'ai choisi les variables d'environnement comme interrupteur :

- `ENABLE_FILE_LOG=1` active le logging vers fichier. Si elle est absente ou définie à toute autre valeur que `1`, l'application se comporte exactement comme avant : overhead nul, aucun fichier créé.
- `MAX_LOG_COUNT` fixe le nombre de fichiers de log à conserver en rotation (par défaut : 10).


Il y a un détail non évident qui vaut la peine d'être signalé lors des tests depuis Qt Creator : `QProcessEnvironment::systemEnvironment()` renvoie un instantané de l'environnement du *processus parent*, pris au moment de son démarrage. Si vous définissez la variable après avoir déjà ouvert l'IDE, l'application enfant héritera quand même de l'ancien environnement. Il faut la définir dans *Projects → Run → Environment*, ou redémarrer l'IDE complètement.

## Où le fichier atterrit vraiment

Un chemin relatif comme `QFile file("app_debug.log")` est résolu par rapport au *répertoire de travail* du processus, qui **ne correspond pas toujours** au dossier de l'exécutable : depuis un terminal, généralement si, depuis Qt Creator, ça dépend du dossier de build défini dans le projet, et sur un service Linux (`systemd`), ce peut être `/` ou `/root`, souvent en lecture seule.

Pour obtenir un comportement prévisible, j'ai forcé le chemin par rapport au dossier de l'exécutable en utilisant `QCoreApplication::applicationDirPath()`, et j'ai utilisé `QDir::filePath()` plutôt que la concaténation manuelle de chaînes — cela évite les problèmes de séparateur (`/` sur Linux/macOS, `\` sur Windows) et les doubles barres obliques quand `applicationDirPath()` se termine déjà par un séparateur.

## Rotation des logs : le bug du compteur coincé

La première version de la logique de rotation comptait les fichiers `.log` du dossier et, une fois le seuil `m_maxLogFiles` atteint, écrasait toujours `logFile_1.log`. Ça semblait correct jusqu'à ce qu'on réfléchisse à ce qui se passe à l'exécution suivante : au démarrage, le nombre de fichiers dans le dossier redevient égal au maximum, donc la logique choisit à nouveau `logFile_1.log` — `logFile_2.log` et `logFile_3.log` ne sont plus jamais touchés. Un bug silencieux : aucun plantage, juste une rotation qui s'arrête discrètement de tourner.

Le correctif a consisté à trier les fichiers par date de modification et à toujours recycler le plus ancien (une politique FIFO), indépendamment des noms de fichiers :

```cpp
QString LoggerManager::getNextLogFileName(const QString &folderPath)
{
    QDir dir(folderPath);
    dir.setNameFilters(QStringList() << "*.log");
    dir.setFilter(QDir::Files);

    // premier élément : le plus ancien
    dir.setSorting(QDir::Time | QDir::Reversed);

    QFileInfoList logFiles = dir.entryInfoList();

    if (logFiles.size() < m_maxLogFiles) {
        return QString("logFile_%1.log").arg(logFiles.size() + 1);
    }

    return logFiles.first().fileName();
}
```

Ainsi, une fois le nombre maximal de fichiers atteint, le système recycle toujours celui qui a été mis à jour le moins récemment, sans jamais dépasser l'espace configuré — et sans dépendre d'un schéma de numérotation que l'utilisateur pourrait casser en supprimant un fichier à la main.

## Le résultat : deux lignes dans main

Tout ce travail d'encapsulation existe pour une seule raison : celui qui intègre la bibliothèque dans un autre projet ne devrait pas avoir à s'en soucier.

```cpp
#include "loggermanager.h"

int main(int argc, char *argv[])
{
    QApplication a(argc, argv);

    // Doit venir après QApplication a(argc, argv)
    LoggerManager lm;
    lm.init();

    MainWindow w;
    w.show();

    return a.exec();
}
```

Comportement par défaut : aucune variable d'environnement définie, aucun fichier créé, aucune différence avec le projet d'origine. Sur le terrain, face à un plantage impossible à reproduire, il suffit de définir `ENABLE_FILE_LOG=1` avant de relancer l'exécutable et de récupérer le fichier `.log` dans le dossier voisin de l'`.exe` — sans toucher une seule ligne de code ni recompiler quoi que ce soit.

## Ce que j'en retiens

La valeur de cet outil ne tient pas à la classe elle-même — quelques dizaines de lignes — mais aux contraintes qui l'ont façonnée : aucune dépendance à des fichiers externes, aucun impact sur le projet hôte quand il est désactivé, et une rotation des logs qui ne casse pas silencieusement après le premier cycle. Ce sont exactement ce genre de détails qui, sur un système en production, font la différence entre un outil qu'on utilise vraiment et un outil qu'on écrit une fois puis qu'on oublie.

Le code vit dans le dépôt des projets ; s'il peut vous servir sur l'un de vos propres projets Qt, l'intégrer prend littéralement deux lignes : [Dépôt](https://github.com/kineticCode-dev/qDebugRedirection)
