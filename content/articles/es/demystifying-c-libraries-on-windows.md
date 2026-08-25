---
title: "Desmitificando las librerías C en Windows: cómo inspeccionar y perfilar archivos .dll desconocidos"
description: "Una guía práctica para inspeccionar y perfilar archivos .dll desconocidos en entornos Windows."
date: "2026-07-18"
category: "software"
tags: ["C++", "Windows", "DLL", "Depuración"]
---


# Índice
1. [Introducción: el problema real](#introduction-the-real-world-problem)
2. [El reto: información faltante](#the-challenge-missing-information)
3. [Inspeccionar y perfilar binarios (.dll y .h)](#inspecting-and-profiling-binaries-dll-and-h)
   1. [Determinar la arquitectura de la librería](#determining-the-librarys-architecture)
   2. [Identificar el compilador utilizado](#identifying-the-compiler-used)
4. [Resumen y reglas generales](#summary--general-rules)

---

## Introducción: el problema real
La idea de este artículo viene de un problema concreto que me encontré hace poco. Trabajamos codo con codo con una empresa asociada que nos proporcionó varias librerías en C que, pensamos, podían resultar útiles para la aplicación que estamos desarrollando en este momento. Después de una reunión en la que nos recomendaron las librerías más adecuadas, nos enviaron un lote de archivos `.zip`.

Dentro de cada `.zip` encontramos:
* Archivos de cabecera (`.h`)
* Librerías dinámicas compiladas (`.dll`)

## El reto: información faltante
Mi entorno de desarrollo principal es Windows, y escribo código C con Visual Studio Code. Ya tenía experiencia importando librerías en Qt y en Visual Studio, pero en esos entornos, junto a los archivos `.h` y `.dll`, solía contar también con los archivos de importación `.lib`. Aquí, en cambio, brillaban por su ausencia.

Además, hay una regla de oro en el desarrollo en C: lo ideal es usar en tu proyecto el mismo compilador con el que se compiló la librería que te han entregado.

Todo esto me dejó con bastantes preguntas: ¿es adecuada la librería que nos dieron? ¿Qué compilador debería usar? ¿Y cómo, en la práctica, importo esta librería en Visual Studio Code?

Vamos a resolverlo juntos, paso a paso.

## Inspeccionar y perfilar binarios (.dll y .h)
Lo primero que hay que comprobar es que la `.dll` esté compilada para la misma arquitectura que nuestro sistema de desarrollo y nuestro compilador.

Si intentamos cargar una `.dll` de 32 bits en un ejecutable de 64 bits, obtendremos un error a nivel del sistema operativo (`Bad Image Format, 0xc000007b`). Lo mismo ocurre al revés: cargar una `.dll` de 64 bits en un ejecutable de 32 bits produce el mismo error `Bad Image Format`.

### Determinar la arquitectura de la librería
Para averiguar para qué arquitectura se compiló la librería, podemos abrir el **Developer Command Prompt for VS22** en Windows y movernos hasta la carpeta que contiene la `.dll` con el comando `cd`.

Una vez allí, ejecutamos este comando en la terminal:
```cmd
dumpbin /headers your_library_name.dll
```

Buscamos la sección `FILE HEADER VALUES` en la salida. Si encontramos:
* **`14C machine (x86)`**: la librería es de 32 bits.
* **`8664 machine (x64)`**: la librería es de 64 bits.

![Arquitectura](/architecture.png)

*(En mi caso, la librería que intentaba importar resultó ser de 32 bits.)*

### Identificar el compilador utilizado
Para averiguar con qué compilador se construyó la librería, podemos lanzar otro comando desde la misma terminal:
```cmd
dumpbin /dependents your_library_name.dll
```

Analizando la sección `Image has the following dependencies:`, podemos deducir el compilador:

![Compilador](/compiler.png)

Si vemos dependencias como:
* `KERNEL32.dll`
* `msvcrt.dll`
* `libgcc_s_dw2-1.dll`
...lo más probable es que la librería se haya compilado con **MinGW**.

Si en cambio vemos dependencias como:
* `MSVCRXX.dll` (donde XX es un número de versión)
* `VCRUNTIME140.dll`
* `ucrtbase.dll`
...entonces se compiló con **Microsoft Visual C++ (MSVC)**.

## Resumen y reglas generales
Como regla general a la hora de trabajar con librerías dinámicas en Windows:

* **Si una librería se compiló con MinGW**, normalmente solo necesitas dos archivos:
  * El archivo de cabecera (`.h`)
  * La librería compilada (`.dll`)
  * *Nota: el enlazador de MinGW (`ld`) puede leer directamente los símbolos dentro del archivo `.dll` sin necesitar un archivo de importación. Sin embargo, en proyectos complejos, puede seguir haciendo falta un archivo de importación como `.dll.a`.*

* **Si una librería se compiló con MSVC**, normalmente necesitas tres archivos:
  * El archivo de cabecera (`.h`)
  * La librería compilada (`.dll`)
  * El archivo de importación (`.lib`)

Como estamos hablando de librerías con enlace dinámico, recuerda que todos los archivos `.dll` deben colocarse junto al ejecutable, en la carpeta de instalación. Si en cambio compilaras de forma estática, el código de la librería quedaría incrustado directamente en tu archivo ejecutable.
