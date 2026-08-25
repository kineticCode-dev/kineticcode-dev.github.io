---
title: "Construir un rastreador de gastos personales desde cero: arquitectura y diseño de la base de datos (Parte 1)"
description: "Este artículo repasa el proceso de diseño y desarrollo de una aplicación web para el seguimiento de gastos personales. El objetivo no es solo crear una herramienta funcional, sino analizar cada decisión de ingeniería y entender el 'porqué' detrás de nuestras elecciones tecnológicas."
date: "2026-07-18"
category: "progetti"
tags: ["Flutter", "Base de datos", "Supabase", "Frotend", "BaaS"]
---

Este artículo repasa el proceso de diseño y desarrollo de una aplicación web para el seguimiento de gastos personales. El objetivo no es solo crear una herramienta funcional, sino analizar cada decisión de ingeniería y entender el "porqué" detrás de nuestras elecciones tecnológicas.

Este proyecto quiere ser didáctico pero práctico, manteniendo un enfoque profesional sin caer en el over-engineering ni perderse en funcionalidades innecesarias. ¡Empecemos!

[Enlace al repositorio de GitHub](https://github.com/kineticCode-dev/03-webappTrackingSpeseDummy)

# Índice
1. [Especificaciones Técnicas](#technical-specifications)
2. [Arquitectura del Proyecto](#project-architecture)
3. [Modelado de la Base de Datos](#database-modeling)
4. [Configuración de la Base de Datos en la Nube: Supabase](#cloud-database-setup-supabase)

---

## Especificaciones Técnicas

El objetivo es simple: construir un rastreador de gastos personales. Las ideas centrales son:
- Desarrollar una base de datos para almacenar todos los gastos del usuario.
- Construir una web app con un doble propósito:
  - Añadir, eliminar o editar gastos en la base de datos.
  - Mostrar un panel resumen con varios gráficos (gastos semanales, mensuales, etc.).

El caso de uso típico es este: abrir la web app directamente desde el navegador (PC, tablet, smartphone), añadir un gasto y visualizar la tendencia financiera. Para garantizar que sea funcional en el uso diario, una base de datos en la nube es la solución preferida, de forma que la app quede accesible las 24 horas del día, los 7 días de la semana.

Aunque ya existen muchas apps de seguimiento de gastos, nuestro objetivo es aprender la tecnología que hay detrás, quedándonos solo con lo esencial para el propósito del proyecto.

## Arquitectura del Proyecto

El software está estructurado en componentes distintos. Al principio se consideró una arquitectura estándar de 3 niveles:
- **Frontend:** interfaz gráfica accesible desde el navegador.
- **Backend:** aplicación que gestiona las peticiones del frontend y las dirige hacia la base de datos.
- **Base de datos:** fuente de datos basada en la nube.

Sin embargo, al utilizar una base de datos cloud moderna de tipo Backend-as-a-Service (BaaS), podemos evitar desarrollar una API de backend personalizada. Por simplicidad y eficiencia, desarrollaremos solo el frontend en **Flutter**, que se comunicará directamente con nuestra base de datos en la nube.

## Modelado de la Base de Datos

En esta fase definimos la estructura conceptual de los datos, elegimos nuestro proveedor cloud y configuramos las tablas iniciales y sus relaciones.

Necesitamos dos tablas distintas:
1. **Tabla de Categorías** (Tag)
2. **Tabla de Gastos**

### 1. Tabla de Categorías
Esta tabla contiene los distintos tipos de gasto.

| id    | category_name   |
| :---- | :-------------- |
| **1** | Alimentación |
| **2** | Coche y transporte |
| **3** | Facturas y hogar |
| **4** | Ocio |

### 2. Tabla de Gastos
Esta tabla registra cada transacción.

| expense_id | amount | date | category_id | notes |
| :--- | :--- | :--- | :--- | :--- |
| **101** | 45.50 | 2026-07-06 | **1** | Compra semanal en el súper |
| **102** | 62.00 | 2026-07-07 | **2** | Gasolinera |
| **103** | 12.50 | 2026-07-08 | **4** | Cine con amigos |
| **104** | 120.00 | 2026-07-08 | **3** | Factura de la luz |
| **105** | 4.80 | 2026-07-08 | **1** | *vacío* |

Entre estas dos tablas existe una **relación 1:N (uno a muchos)**: la misma categoría puede estar asociada a varias filas de la tabla de gastos. Por ejemplo, la cuota mensual de una hipoteca aparecerá $N$ veces en la tabla de gastos, vinculada siempre a la misma categoría.

## Configuración de la Base de Datos en la Nube: Supabase

Con las tablas ya definidas, podemos configurar nuestra base de datos usando **Supabase**, una alternativa open source a Firebase.

1. Crea una cuenta en el dashboard de Supabase e inicia un nuevo proyecto.
2. Se te pedirá que introduzcas una contraseña de la base de datos (que el frontend usará para comunicarse con la BD). Deja los demás parámetros con sus valores predeterminados.
3. Una vez creado el proyecto, ve al **Table Editor** para crear nuestras dos tablas. La tabla de gastos tendrá una foreign key que apunta al ID de la categoría.

### Definición de las Tablas en Supabase:
**Tabla de Categorías (`tag`)**
- `id`: identificador único (Primary Key)
- `name`: nombre de la categoría (p. ej., hipoteca, gasolina, supermercado)

**Tabla de Gastos (`expenses`)**
- `id`: identificador único (Primary Key)
- `amount`: valor numérico
- `date`: fecha de la transacción
- `id_tag`: Foreign Key vinculada a la tabla de Categorías
- `notes`: texto opcional

Con la base de datos creada, estamos listos para conectarnos a ella desde el frontend y empezar a insertar datos de prueba. Puedes encontrar los parámetros de conexión a la base de datos (host, puerto, nombre de la base de datos, usuario) en el dashboard de Supabase, dentro de la configuración de conexión (seleccionando en concreto el transaction pooler).

---
*En la Parte 2 veremos cómo configurar nuestro frontend en Flutter, conectarlo a Supabase y diseñar la interfaz de usuario. ¡No te lo pierdas!*
