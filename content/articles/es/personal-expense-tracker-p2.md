---
title: "Construyendo un Rastreador de Gastos Personales desde Cero: Arquitectura y Diseño de la Base de Datos (Parte 2)"
description: "Este artículo repasa el proceso de diseño y desarrollo de una aplicación web para el seguimiento de gastos personales. El objetivo no es solo crear una herramienta funcional, sino analizar cada decisión de ingeniería y entender el 'porqué' detrás de nuestras elecciones tecnológicas."
date: "2026-07-18"
category: "progetti"
tags: ["Flutter", "Base de datos", "Supabase", "Frotend", "BaaS"]
---

¡Bienvenidos de nuevo! En la **Parte 1** vimos las decisiones arquitectónicas y configuramos nuestra base de datos con Supabase. En esta segunda parte nos adentramos en el desarrollo del frontend con **Flutter**. Configuraremos el proyecto, lo conectaremos a nuestra base de datos en la nube y empezaremos a construir la interfaz de usuario.

[Enlace al repositorio de Github](https://github.com/kineticCode-dev/03-webappTrackingSpeseDummy)

# Índice
1. [Configuración del Proyecto](#project-setup-and-configuration)
2. [Conexión con Supabase](#connecting-to-supabase)
3. [Diseño del Mockup de la Web App](#designing-the-web-app-mockup)
4. [Compilación Web y Pruebas Locales](#web-compilation-and-local-testing)
5. [Desarrollo de la Vista de Inserción](#developing-the-insert-view)

---

## Configuración del Proyecto

Vamos a usar Flutter para construir una interfaz web responsive. Si no tienes Flutter instalado, encontrarás las instrucciones en la [documentación oficial](https://docs.flutter.dev/install).

Para generar el esqueleto del proyecto específico para web, ejecuta este comando en tu terminal:

```bash
$ flutter create . --platform=web
```

Al especificar `--platform=web`, obtenemos una estructura de proyecto más ligera, sin las carpetas para Android, iOS o Windows.

A continuación, instalamos el SDK oficial de Supabase para Flutter:

```bash
$ flutter pub add supabase_flutter
```

Para comprobar que todo funciona, ejecutemos la app en Chrome:

```bash
$ flutter run -d chrome
```

Debería abrirse automáticamente una ventana de Chrome con la demo predeterminada de Flutter. Deja esta ventana abierta: gracias al **hot reload** de Flutter, la página se actualizará automáticamente cada vez que guardemos cambios en el código.

## Conexión con Supabase

Veamos ahora si nuestra app Flutter puede comunicarse con Supabase. En Flutter, todo es un widget: los botones, el texto e incluso la alineación son widgets. Modificaremos la app de demostración para conectarla a nuestra base de datos y probar la inserción de una categoría.

Primero, consigue los datos de conexión de Supabase. En tu panel de Supabase, ve a la configuración de conexión, selecciona Flutter como framework y copia los valores de `url` y `publishableKey`.

Actualiza la función `main` de Flutter para inicializar Supabase al arrancar:

```dart
void main() async {
  // Asegura que el motor de Flutter esté listo antes de usar llamadas de red
  WidgetsFlutterBinding.ensureInitialized();

  // Inicializa Supabase con los datos de tu proyecto
  await Supabase.initialize(
    url: 'YOUR_PROJECT_URL',
    publishableKey: 'YOUR_PUBLISHABLE_KEY',
  );

  // Ejecuta la app
  runApp(const MyApp());
}
```

*Nota: antes de escribir en las tablas de Supabase desde el cliente, asegúrate de configurar correctamente la Row Level Security (RLS). Para las primeras pruebas puedes desactivar temporalmente la RLS, ¡pero recuerda siempre proteger tus tablas en producción!*

Aquí tienes un widget sencillo para probar la escritura en la base de datos:

```dart
class ConnectionTestPage extends StatefulWidget {
  const ConnectionTestPage({super.key});
  @override
  State<ConnectionTestPage> createState() => _ConnectionTestPageState();
}

class _ConnectionTestPageState extends State<ConnectionTestPage> {
  bool _isLoading = false;
  String _resultMessage = 'No test executed yet';

  Future<void> _sendTestData() async {
    setState(() {
      _isLoading = true;
      _resultMessage = 'Sending data...';
    });

    try {
      await Supabase.instance.client
          .from('tag')
          .insert({'name': 'flutter'});

      setState(() {
        _resultMessage = 'Success! Connection and write working.';
      });
    } catch (error) {
      setState(() {
        _resultMessage = 'Error during send: $error';
      });
    } finally {
      setState(() {
        _isLoading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Supabase Connection Test')),
      body: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Text(_resultMessage, style: const TextStyle(fontSize: 18), textAlign: TextAlign.center),
            const SizedBox(height: 20),
            _isLoading
                ? const CircularProgressIndicator()
                : ElevatedButton(
                    onPressed: _sendTestData,
                    child: const Text('Send Test Data'),
                  ),
          ],
        ),
      ),
    );
  }
}
```

Al pulsar el botón, ¡se añadirá una nueva categoría "flutter" a nuestra base de datos!

## Compilación Web y Pruebas Locales

Para compilar la app para producción en la web, ejecuta:

```bash
$ flutter build web --release
```

Esto genera `index.html` y los archivos JavaScript necesarios en la carpeta `build/web`.

Para ver cómo se ve la web app en tu móvil (siempre que esté en la misma red WiFi), puedes iniciar un servidor local sencillo desde la carpeta `build/web`:

```bash
$ python -m http.server 8080
```

Después, abre el navegador de tu teléfono y ve a la dirección IP local de tu ordenador (por ejemplo, `http://192.168.1.50:8080`).

## Cerrando la Parte 2
En este episodio hemos puesto en marcha con éxito nuestra aplicación web Flutter y hemos establecido una conexión directa y funcional con nuestro backend de Supabase. Ahora podemos leer y escribir datos de forma segura en nuestra base de datos en la nube directamente desde el frontend, eliminando así la necesidad de una API intermedia personalizada.

***¿Qué viene en la Parte 3?*** Ahora que la parte técnica está lista, podemos centrarnos en la experiencia de usuario. En el próximo artículo daremos vida a nuestra app explorando los mockups de la interfaz, construyendo las pantallas de entrada de datos (Vista de Inserción) y sentando las bases de nuestra Dashboard interactiva. ¡Manteneos atentos!
