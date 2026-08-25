---
title: "Construyendo un Rastreador de Gastos Personales desde Cero: Arquitectura y Diseño de la Base de Datos (Parte 3)"
description: "Este artículo repasa el proceso de diseño y desarrollo de una aplicación web para el seguimiento de gastos personales. El objetivo no es solo crear una herramienta funcional, sino analizar cada decisión de ingeniería y entender el 'porqué' detrás de nuestras elecciones tecnológicas."
date: "2026-07-18"
category: "progetti"
tags: ["Flutter", "Base de datos", "Supabase", "Frotend", "BaaS"]
---

¡Bienvenidos de nuevo! En la **Parte 2** cubrimos el desarrollo del frontend usando **Flutter**. Configuramos el proyecto, lo conectamos a nuestra base de datos en la nube y empezamos a construir la interfaz de usuario.

[Enlace al Repositorio de Github](https://github.com/kineticCode-dev/03-webappTrackingSpeseDummy)

# Mockups de la Webapp
La webapp estará compuesta por dos pantallas diferentes:
* Un dashboard: donde mostraremos gráficos de barras y gráficos circulares.
* Una pantalla de inserción: donde podremos añadir gastos a nuestra base de datos.

El mockup del dashboard es este:
![Vista Principal](./img/mainView.png)

El mockup de la vista de inserción es este:
![Vista de Inserción](./img/insertView.png)

## Desarrollo de la Vista de Inserción
En esta sección desarrollaremos la vista de inserción, que nos permite añadir un gasto a la base de datos.
El usuario deberá introducir:
* El importe del gasto/ingreso. Los gastos se insertarán como importes negativos, y los ingresos como importes positivos.
* La fecha en que ocurrió el gasto.
* La categoría a la que pertenece.
* Notas.

La interfaz final es esta:
![Vista de Inserción](./img/insert_view.png)

## Desarrollo de la Vista del Dashboard
Ahora desarrollaremos la Vista del Dashboard, que será la pantalla resumen de nuestras finanzas. La idea es incluir algunos gráficos para mostrar de inmediato nuestro estado financiero. Debemos tener en cuenta que se usará principalmente desde el móvil, así que la pantalla será pequeña. Es muy importante organizar el espacio de la mejor manera posible. Una buena idea podría ser: muestro un solo gráfico a la vez, y de alguna manera tengo la posibilidad de cambiar de vista.

Empecemos instalando el paquete de Flutter que nos permite dibujar gráficos:

```bash
$ flutter pub add fl_chart
```

Luego importamos el paquete:

```dart 
import 'package:fl_chart/fl_chart.dart';
```

El primer gráfico que desarrollaremos será el de los gastos del mes actual. Para ello usaremos un clásico gráfico circular.
A la hora de calcular los gastos mensuales, tenemos dos enfoques posibles:
* Leo todos los gastos del mes desde la base de datos hacia Flutter, y dentro de Flutter recorro gasto por gasto y calculo lo que necesito, como el importe final y el importe por categoría.
* Agrego los datos directamente dentro de la base de datos y manipulo una parte de los datos que ya vienen agregados.

Seguiremos este segundo camino. Esto nos permite delegar en la base de datos la mayor cantidad posible de trabajo pesado y filtrado, porque una base de datos es una herramienta creada precisamente para hacer agregaciones.
Para ello usaremos un Stored Procedure. Un `Stored Procedure`, o `Function`, es un bloque de código escrito en lenguaje SQL que se guarda y se ejecuta directamente dentro de la base de datos. Podemos pensarlo como una auténtica función de software, con argumentos de entrada y un valor de retorno, que vive en el servidor de la base de datos. Todo cliente que se conecta a la base de datos tiene estas funciones disponibles.

¿Por qué es mejor usar un Stored Procedure en nuestro caso? Estas son las razones:
* **Eficiencia de red:** si un usuario ha registrado 200 gastos en un mes, una consulta estándar descargaría 200 registros JSON a través de internet. Con el stored procedure, la base de datos calcula las sumas internamente y devuelve solo unas pocas filas (una por cada categoría activa, por ejemplo, 5 filas). Menos datos viajando significa una app más rápida.
* **Rendimiento:** el motor SQL de PostgreSQL está altamente optimizado para recorrer y agregar registros. Ejecutar la suma (`SUM`) y la agrupación (`GROUP BY`) de forma nativa en el servidor es infinitamente más rápido que hacer la misma operación recorriendo una lista en Dart en la CPU de un smartphone.
* **Superar los límites de la API del cliente:** las librerías cliente de Supabase son excelentes para operaciones CRUD simples, pero no soportan de forma nativa la cláusula SQL `GROUP BY`. Crear una función en la base de datos nos permite aprovechar todo el poder del lenguaje SQL (PL/pgSQL), exponiéndolo a Flutter con una llamada muy sencilla.

Todo esto también es válido para los gastos semanales, así que creemos un stored procedure genérico que reciba como entrada:
* año
* mes/semana
* granularidad (mensual/semanal)

Y devuelva, para ese mes/semana específico:
* categoría de gasto
* importe

Para ello, vamos a Supabase, al editor SQL, y escribimos este código:

```sql
CREATE OR REPLACE FUNCTION get_aggregated_expenses(
    req_year INT,
    req_value INT, -- Mes (1-12) o semana (1-53)
    time_frame TEXT -- Puede ser 'monthly' o 'weekly'
)
RETURNS TABLE (category_name TEXT, total_amount NUMERIC) AS $$
BEGIN
    IF time_frame = 'weekly' THEN
        RETURN QUERY
        SELECT
            t.name::TEXT as category_name,
            SUM(e.importo)::NUMERIC as total_amount
        FROM expenses e
        JOIN tag t ON e.id_tag = t.id
        WHERE EXTRACT(YEAR FROM e.data) = req_year
          AND EXTRACT(WEEK FROM e.data) = req_value
        GROUP BY t.name;
    ELSE
        RETURN QUERY
        SELECT
            t.name::TEXT as category_name,
            SUM(e.importo)::NUMERIC as total_amount
        FROM expenses e
        JOIN tag t ON e.id_tag = t.id
        WHERE EXTRACT(YEAR FROM e.data) = req_year
          AND EXTRACT(MONTH FROM e.data) = req_value
        GROUP BY t.name;
    END IF;
END;
$$ LANGUAGE plpgsql;
```

En el lado del cliente, para conocer la lista de gastos de un mes específico, simplemente necesitamos hacer:

```sql
SELECT * FROM get_aggregated_expenses(2026, 7, 'monthly');
```

Y para conocer la lista de gastos de una semana específica:

```sql
SELECT * FROM get_aggregated_expenses(2026, 28, 'weekly');
```

Y la base de datos responderá con los datos solicitados.

El Dashboard final es este:

![Dashboard](./img/dashboard_view.png)

![Dashboard2](./img/dashboard_view2.png)

## Publicar la webapp online
Para alojar nuestra webapp de Flutter, usaremos GitHub Pages como servicio de hosting para sitios estáticos, que es completamente gratuito. Una vez compilada, nuestra webapp no es más que un conjunto de archivos `HTML, CSS, JavaScript y assets`.

Veamos los pasos para hacerlo. Los prerrequisitos son:
* Una cuenta de GitHub
* Git instalado en el PC
* El build de la webapp

### Paso 1: Cambiar el `base href` en Flutter
Abramos la terminal en la raíz del proyecto Flutter, donde se encuentra el archivo `pubspec.yaml`, y ejecutemos el siguiente comando en la terminal:
```bash
flutter build web --release --base-href "/<name-of-your-repo>/" --pwa-strategy=none
```

En este punto, la compilación comenzará dentro de la carpeta `/build/web`. Cuando termine, encontraremos los archivos `index.html`, `main.dart.js`, `flutter_bootstrap.js` y `flutter_service_worker.js`.

### Paso 2: Crear el Repositorio en GitHub
1. Vamos a GitHub y creamos un nuevo repositorio.
2. Elegimos el nombre (el mismo usado en el `--base-href`).
3. Configuramos el repositorio como público, lo cual es necesario para tener GitHub Pages de forma gratuita.
4. Dejamos sin marcar las opciones "`Add a README`" o "`.gitignore`".

### Paso 3: El truco del 404 para las SPA
Para resolver el problema con las recargas de página, aplicamos la siguiente solución:
1. Navegamos hasta la carpeta `build/web` en nuestro PC.
2. Duplicamos el archivo `index.html` y lo renombramos a `404.html`.
De esta manera, si un usuario recarga la página en una URL profunda, GitHub no encontrará la página, cargará el archivo `404.html` (idéntico a `index.html`), y Flutter tomará el control leyendo la URL y llevando al usuario a la pantalla correcta.

### Paso 4: Subir los archivos
Añadimos toda la carpeta `build/web` al repositorio de GitHub recién creado.

### Paso 5: Habilitar GitHub Pages
1. Vamos a nuestro repositorio de GitHub.
2. Hacemos clic en **Settings**, arriba a la derecha.
3. En el menú de la izquierda, hacemos clic en **Pages**.
4. En **Build and deployment**, configuramos la fuente en **Deploy from a branch**.
5. En **Branch**, seleccionamos `main` y la carpeta `/ (root)`, y luego hacemos clic en **Save**.
6. GitHub Actions construirá la página. Encontraremos la URL final en la parte superior de la misma sección Pages en cuanto el proceso termine; tarda un par de minutos.
