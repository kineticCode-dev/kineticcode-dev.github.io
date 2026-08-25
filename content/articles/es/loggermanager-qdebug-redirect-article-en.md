---
title: "Redirigir los qDebug de Qt a un archivo sin recompilar: la clase LoggerManager"
description: "Un cuelgue en campo que no podía diagnosticar, sin forma de recompilar en el sitio, y la clase C++/Qt que escribí para capturar los logs en tiempo de ejecución — con todos los errores de enlazado que me encontré por el camino."
date: "2026-08-05"
category: "software"
tags: ["cpp", "qt", "depuracion", "herramientas"]
---

## El problema, en campo

Una aplicación Qt en C++, ya compilada e instalada en la máquina de un cliente, había empezado a colgarse. Ninguna salida en absoluto: el ejecutable se había compilado sin `console` en el archivo `.pro`, así que cada línea de `qDebug()` desaparecía sin más en el instante en que la app se cerraba.

La solución rápida la conoce cualquier desarrollador Qt: añadir `CONFIG += console` al archivo `.pro`, recompilar, ejecutar desde una terminal y leer la salida de `qDebug()` en vivo mientras la app se cuelga. Funcionó, pero me dejó con una pregunta incómoda: ¿y si no podía recompilar? Un cliente no espera a que prepares una build de depuración y se la envíes — quiere el archivo de log de lo que ya está corriendo en su máquina, ahora mismo.

De ahí salió la idea: una pequeña librería que captura cada `qDebug()`, `qWarning()`, `qCritical()` de una aplicación Qt y los escribe en un archivo, activable y desactivable en tiempo de ejecución, sin tocar el código existente ni recompilar nada.

[Repositorio](https://github.com/kineticCode-dev/qDebugRedirection)

## La restricción de diseño

Para ser realmente útil en un proyecto ya existente, la solución tenía que cumplir dos condiciones:

- **impacto casi nulo en el código del proyecto anfitrión**: incluir un header y añadir dos líneas en `main`, nada más.
- **sin recompilar para activar o desactivar el logging**: el comportamiento tiene que controlarse desde fuera, mediante variables de entorno.

Qt ya nos da el gancho adecuado para esto: `qInstallMessageHandler()`. Es una función a nivel de sistema construida para interceptar *cada* mensaje del framework (`qDebug`, `qWarning`, `qCritical`, `qFatal`) y redirigirlo adonde quieras, antes incluso de que llegue a la consola.

## La primera trampa: los callbacks al estilo C no tienen `this`

El primer prototipo era una única función libre pasada a `qInstallMessageHandler`. Funcionaba, pero no era limpio: quería envolverla dentro de una clase, de modo que en `main` pudiera simplemente escribir

```cpp
LoggerManager lm;
lm.init();
```

en lugar de dejar una función suelta flotando en el ámbito global. Aquí es donde apareció la primera restricción técnica no evidente: `qInstallMessageHandler` espera un puntero a función con una firma fija,

```cpp
void (*)(QtMsgType, const QMessageLogContext &, const QString &)
```

Un método de instancia normal tiene un parámetro extra oculto bajo el capó: el puntero `this`. Las dos firmas no coinciden, y el compilador no convierte un método de instancia en ese tipo de puntero a función. Qt sigue apoyándose en punteros a función al viejo estilo C para este tipo de gancho de sistema, sin ningún envoltorio como `std::function` o una lambda que capture contexto.

La consecuencia práctica: `messageHandler` tiene que permanecer `static` (o ser una función libre fuera de la clase), y como resultado, cualquier estado que esa función lea — en nuestro caso, el nombre del archivo de log — también tiene que ser `static`. `init()`, en cambio, puede seguir siendo un método de instancia normal: ahí es donde se construye la ruta, se leen las variables de entorno, y se toma la decisión de instalar el handler.

## El segundo tropiezo: LNK2019

Con la clase reescrita, la build fallaba con un clásico `LNK2019: unresolved external symbol` sobre el miembro estático `m_fileName`. La razón: en C++ (hasta C++17), declarar un miembro `static` en el header solo declara que *existe*, no reserva memoria para él. Hace falta una línea de definición explícita en el archivo `.cpp`:

```cpp
QString LoggerManager::m_fileName = "app_debug.log";
```

Un detalle de manual, pero es exactamente el tipo de error que solo te tomas en serio cuando lo ves aparecer en el enlazador de un proyecto real, no en un tutorial.

## Activarlo en tiempo de ejecución, sin un archivo `.ini`

Para evitar depender de un archivo de configuración externo — que en un despliegue industrial podría faltar, ser sobrescrito, o acabar en solo lectura — elegí las variables de entorno como interruptor:

- `ENABLE_FILE_LOG=1` activa el registro en archivo. Si falta o está establecida a cualquier valor distinto de `1`, la aplicación se comporta exactamente igual que antes: overhead cero, ningún archivo creado.
- `MAX_LOG_COUNT` fija cuántos archivos de log mantener en rotación (por defecto: 10).


Hay un detalle no evidente que vale la pena señalar al probar desde Qt Creator: `QProcessEnvironment::systemEnvironment()` devuelve una instantánea del entorno del *proceso padre*, tomada cuando este se inició. Si estableces la variable después de haber abierto ya el IDE, la app hija heredará igualmente el entorno antiguo. Hay que fijarla en *Projects → Run → Environment*, o reiniciar el IDE desde cero.

## Dónde acaba realmente el archivo

Una ruta relativa como `QFile file("app_debug.log")` se resuelve respecto al *directorio de trabajo* del proceso, que **no siempre coincide** con la carpeta del ejecutable: desde una terminal normalmente sí, desde Qt Creator depende de la carpeta de build configurada en el proyecto, y en un servicio Linux (`systemd`) puede ser `/` o `/root`, a menudo de solo lectura.

Para conseguir un comportamiento predecible, forcé la ruta relativa a la carpeta del ejecutable usando `QCoreApplication::applicationDirPath()`, y usé `QDir::filePath()` en lugar de la concatenación manual de cadenas — evita problemas de separador (`/` en Linux/macOS, `\` en Windows) y dobles barras cuando `applicationDirPath()` ya termina con un separador.

## Rotación de logs: el bug del contador atascado

La primera versión de la lógica de rotación contaba los archivos `.log` de la carpeta y, al alcanzar el umbral `m_maxLogFiles`, siempre sobrescribía `logFile_1.log`. Parecía correcta hasta que piensas en lo que ocurre en la siguiente ejecución: al arrancar, el recuento de archivos en la carpeta vuelve a ser igual al máximo, así que la lógica vuelve a elegir `logFile_1.log` — `logFile_2.log` y `logFile_3.log` nunca vuelven a tocarse. Un bug silencioso: sin cuelgue, solo una rotación que deja de rotar sin avisar.

La solución fue ordenar los archivos por fecha de modificación y reciclar siempre el más antiguo (una política FIFO), independientemente de los nombres de archivo:

```cpp
QString LoggerManager::getNextLogFileName(const QString &folderPath)
{
    QDir dir(folderPath);
    dir.setNameFilters(QStringList() << "*.log");
    dir.setFilter(QDir::Files);

    // primer elemento: el más antiguo
    dir.setSorting(QDir::Time | QDir::Reversed);

    QFileInfoList logFiles = dir.entryInfoList();

    if (logFiles.size() < m_maxLogFiles) {
        return QString("logFile_%1.log").arg(logFiles.size() + 1);
    }

    return logFiles.first().fileName();
}
```

De este modo, una vez alcanzado el número máximo de archivos, el sistema siempre recicla el que se actualizó menos recientemente, sin superar nunca el espacio configurado — y sin depender de un esquema de numeración que el usuario pudiera romper borrando un archivo a mano.

## El resultado: dos líneas en main

Todo este trabajo de encapsulación existe por una única razón: quien integre la librería en otro proyecto no debería tener que pensar en ello.

```cpp
#include "loggermanager.h"

int main(int argc, char *argv[])
{
    QApplication a(argc, argv);

    // Debe ir después de QApplication a(argc, argv)
    LoggerManager lm;
    lm.init();

    MainWindow w;
    w.show();

    return a.exec();
}
```

Comportamiento por defecto: sin variable de entorno establecida, ningún archivo creado, ninguna diferencia respecto al proyecto original. En campo, ante un cuelgue que no puedes reproducir, basta con establecer `ENABLE_FILE_LOG=1` antes de relanzar el ejecutable y recoger el archivo `.log` de la carpeta junto al `.exe` — sin tocar una sola línea de código ni recompilar nada.

## Lo que me llevo de esto

El valor de esta herramienta no está en la clase en sí — un par de docenas de líneas — sino en las restricciones que la moldearon: sin dependencia de archivos externos, sin impacto en el proyecto anfitrión cuando está desactivada, y una rotación de logs que no se rompe silenciosamente después del primer ciclo. Son exactamente este tipo de detalles los que, en un sistema en producción, marcan la diferencia entre una herramienta que de verdad usas y una que escribes una vez y olvidas.

El código vive en el repositorio de proyectos; si te resulta útil para uno de tus propios proyectos Qt, integrarlo lleva literalmente dos líneas: [Repositorio](https://github.com/kineticCode-dev/qDebugRedirection)
