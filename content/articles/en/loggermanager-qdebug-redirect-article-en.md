---
title: "Redirecting Qt qDebug to a file without recompiling: the LoggerManager class"
description: "A crash in the field I could not diagnose, no way to recompile on the spot, and the C++/Qt class I wrote to catch logs at runtime — with every linking error I hit along the way."
date: "2026-08-05"
category: "software"
tags: ["cpp", "qt", "debugging", "tooling"]
---

## The problem, in the field

A Qt application in C++, already built and installed on a customer machine, started crashing. No output at all: the executable had been built without `console` in the `.pro` file, so every `qDebug()` line just disappeared the moment the app closed.

The quick fix is something every Qt developer knows: add `CONFIG += console` to the `.pro` file, rebuild, run from a terminal, and read the `qDebug()` output live while the app crashes. It worked, but it left me with an uncomfortable question: what if I could not rebuild? A customer does not wait for you to prepare a debug build and send it over — they want the log file from what is already running on their machine, right now.

That is where the idea came from: a small library that catches every `qDebug()`, `qWarning()`, `qCritical()` from a Qt application and writes them to a file, turned on and off at runtime, without touching the existing code or recompiling anything.

[Repository](https://github.com/kineticCode-dev/qDebugRedirection)

## The design constraint

To actually be useful on an existing project, the solution had to meet two conditions:

- **almost no impact on the host project's code**: include one header and add two lines in `main`, nothing more.
- **no recompiling to turn logging on or off**: the behavior has to be controlled from the outside, through environment variables.

Qt already gives us the right hook for this: `qInstallMessageHandler()`. It is a system-level function built to intercept *every* message from the framework (`qDebug`, `qWarning`, `qCritical`, `qFatal`) and redirect it wherever you want, before it even reaches the console.

## The first trap: C-style callbacks have no `this`

The first prototype was a single free function passed to `qInstallMessageHandler`. It worked, but it was not clean: I wanted to wrap it inside a class, so that in `main` I could simply write

```cpp
LoggerManager lm;
lm.init();
```

instead of leaving a bare function floating in the global scope. This is where the first non-obvious technical constraint showed up: `qInstallMessageHandler` expects a function pointer with a fixed signature,

```cpp
void (*)(QtMsgType, const QMessageLogContext &, const QString &)
```

A normal instance method has one hidden extra parameter under the hood: the `this` pointer. The two signatures do not match, and the compiler will not convert an instance method into that kind of function pointer. Qt still relies on old-school C function pointers for this kind of system hook, with no wrapper like `std::function` or a capturing lambda.

The practical consequence: `messageHandler` has to stay `static` (or be a free function outside the class), and as a result, any state that function reads — in our case, the log file name — also has to be `static`. `init()`, on the other hand, can stay a normal instance method: that is where the path is built, the environment variables are read, and the decision to install the handler is made.

## The second stumble: LNK2019

With the class rewritten, the build failed with a classic `LNK2019: unresolved external symbol` on the static member `m_fileName`. The reason: in C++ (up to C++17), declaring a `static` member in the header only declares that it *exists*, it does not allocate memory for it. You need an explicit definition line in the `.cpp` file:

```cpp
QString LoggerManager::m_fileName = "app_debug.log";
```

A textbook detail, but it is exactly the kind of error you only take seriously once you see it come up in the linker on a real project, not in a tutorial.

## Turning it on at runtime, without an `.ini` file

To avoid depending on an external configuration file — which in an industrial deployment might be missing, get overwritten, or end up read-only — I chose environment variables as the switch:

- `ENABLE_FILE_LOG=1` turns on file logging. If it is missing or set to anything other than `1`, the application behaves exactly like before: zero overhead, no file created.
- `MAX_LOG_COUNT` sets how many log files to keep in rotation (default: 10).


There is one non-obvious detail worth pointing out when testing from Qt Creator: `QProcessEnvironment::systemEnvironment()` returns a snapshot of the environment of the *parent process*, taken when it started. If you set the variable after already opening the IDE, the child app will still inherit the old environment. You need to set it in *Projects → Run → Environment*, or restart the IDE from scratch.

## Where the file actually ends up

A relative path like `QFile file("app_debug.log")` resolves against the process's *working directory*, which **does not always** match the folder of the executable: from a terminal it usually does, from Qt Creator it depends on the build folder set in the project, and on a Linux service (`systemd`) it can be `/` or `/root`, often read-only.

To get a predictable behavior, I forced the path relative to the executable's folder using `QCoreApplication::applicationDirPath()`, and used `QDir::filePath()` instead of manual string concatenation — it avoids separator issues (`/` on Linux/macOS, `\` on Windows) and double slashes when `applicationDirPath()` already ends with a separator.

## Log rotation: the stuck-counter bug

The first version of the rotation logic counted the `.log` files in the folder and, once the threshold `m_maxLogFiles` was reached, always overwrote `logFile_1.log`. It looked correct until you think through what happens on the next run: at startup, the file count in the folder is once again equal to the maximum, so the logic picks `logFile_1.log` again — `logFile_2.log` and `logFile_3.log` are never touched again. A silent bug: no crash, just a rotation that quietly stops rotating.

The fix was to sort the files by modification date and always recycle the oldest one (a FIFO policy), independent from file names:

```cpp
QString LoggerManager::getNextLogFileName(const QString &folderPath)
{
    QDir dir(folderPath);
    dir.setNameFilters(QStringList() << "*.log");
    dir.setFilter(QDir::Files);

    // first element: the oldest one
    dir.setSorting(QDir::Time | QDir::Reversed);

    QFileInfoList logFiles = dir.entryInfoList();

    if (logFiles.size() < m_maxLogFiles) {
        return QString("logFile_%1.log").arg(logFiles.size() + 1);
    }

    return logFiles.first().fileName();
}
```

This way, once the maximum number of files is reached, the system always recycles the one that was updated least recently, never going over the configured space — and it does not depend on a numbering scheme the user could break by deleting a file by hand.

## The result: two lines in main

All this encapsulation work exists for one reason: whoever integrates the library into another project should not have to think about it.

```cpp
#include "loggermanager.h"

int main(int argc, char *argv[])
{
    QApplication a(argc, argv);

    // Must come after QApplication a(argc, argv)
    LoggerManager lm;
    lm.init();

    MainWindow w;
    w.show();

    return a.exec();
}
```

Default behavior: no environment variable set, no file created, no difference at all from the original project. In the field, facing a crash you cannot reproduce, you just set `ENABLE_FILE_LOG=1` before relaunching the executable and pick up the `.log` file from the folder next to the `.exe` — without touching a single line of code or recompiling anything.

## What I take from this

The value of this tool is not in the class itself — a few dozen lines — but in the constraints that shaped it: no dependency on external files, no impact on the host project when turned off, and a log rotation that does not silently break after the first cycle. These are exactly the kind of details that, on a system running in production, make the difference between a tool you actually use and one you write once and forget.

The code lives in the projects repository; if it is useful for one of your own Qt projects, integrating it takes literally two lines: [Repository](https://github.com/kineticCode-dev/qDebugRedirection)
