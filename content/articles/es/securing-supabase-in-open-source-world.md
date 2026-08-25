---
title: "Asegurar Supabase en un mundo open source"
description: "Cómo permitir el acceso a la Base de datos de Supabase solo a cuentas autorizadas"
date: "2026-07-19"
category: "software"
tags: ["Base de datos", "Supabase", "RLS"]
---

# Índice
- [1. La paradoja de las API Key en el frontend](#1-the-paradox-of-api-keys-in-the-frontend)
- [2. Row Level Security (RLS) y Database Policies](#2-row-level-security-rls-and-database-policies)
- [3. Implementando el flujo de autenticación](#3-implementing-the-authentication-flow)

## 1. La paradoja de las API Key en el frontend
En el desarrollo de software tradicional, es el backend quien se comunica directamente con la base de datos, guardando todas las credenciales de conexión. Sin embargo, en el mundo Serverless y con las plataformas Backend-as-a-Service (BaaS) como Supabase, es el frontend quien habla directamente con la base de datos. Para hacerlo, necesita dos datos clave:
* La URL de Supabase
* La `anon_key` (clave anónima), que le dice a Supabase: "Este tráfico viene de la webapp X, asígnale a esta petición el rol de usuario anónimo."

El problema es que tanto la URL como la clave anónima quedan guardadas dentro de los archivos JavaScript que se descargan al navegador del usuario. Basta con abrir las herramientas de desarrollador del navegador (F12) para verlas.

Por eso, el frontend es un entorno inseguro. No podemos esconder nada dentro de un archivo JavaScript que se ejecuta en el lado del cliente. Y como una web app tiene que estar en una URL pública para ser accesible desde cualquier sitio, tenemos que aceptar que el frontend está abierto a todo el mundo. Es evidente que la seguridad no puede gestionarse solo en el frontend: tiene que aplicarse a nivel de base de datos. Para lograrlo, usamos una funcionalidad llamada **Row Level Security (RLS)**.

## 2. Row Level Security (RLS) y Database Policies
Las bases de datos tradicionales suelen usar un control de acceso horizontal: si tienes las credenciales de acceso, entras a la tabla; si no las tienes, no entras.
RLS introduce en cambio un control vertical. Cuando la app hace una petición, la base de datos no responde de inmediato: primero revisa fila por fila, aplicando una regla específica definida por el desarrollador. Si la regla devuelve `TRUE`, la fila se muestra; si no, permanece oculta.

Si habilitamos RLS en Supabase sin haber configurado ninguna política de acceso, la base de datos se bloquea al instante. Aunque alguien se conecte con la URL y la clave anónima correctas, solo recibirá una lista vacía.

## 3. Implementando el flujo de autenticación
Para recuperar el acceso a nuestros datos de forma segura, necesitamos que la base de datos reconozca exactamente quién está haciendo la petición. Esto requiere cambios tanto en la base de datos SQL como en el código del frontend.

### Paso 1: Habilita RLS en Supabase
Primero, ve al panel de Supabase, entra en **Database > Tables**, selecciona tus tablas y haz clic en **Enable RLS**. A partir de este momento, tu URL pública dejará de mostrar datos a cualquiera (incluido tú, por ahora).

### Paso 2: Añade un usuario
Ve a la pestaña **Authentication** de Supabase y añade un nuevo usuario. El correo y la contraseña que configures aquí serán los que uses para iniciar sesión desde el frontend.

### Paso 3: Añade una columna de usuario a la base de datos
Para que la base de datos sepa a quién pertenecen ciertos datos, la tabla debe tener una columna vinculada al sistema de autenticación de Supabase:
- Crea una nueva columna llamada `user_id` de tipo `uuid`.
- Establece su valor por defecto en `auth.uid()` (una función nativa de Supabase que obtiene el ID del usuario que está realizando la acción).

### Paso 4: Actualiza el frontend
Ahora tenemos que modificar el frontend para incluir un proceso de inicio de sesión cuando arranca la app. Si el usuario introduce las credenciales correctas, nos conectamos a Supabase usando el siguiente método (ejemplo en Dart/Flutter):

```dart
await Supabase.instance.client.auth.signInWithPassword(
  email: _emailController.text.trim(),
  password: _passwordController.text.trim(),
);
```

Llegados a este punto, la conexión queda autenticada con una contraseña. Supabase ya sabe quiénes somos, pero aún no mostrará los datos de la tabla hasta que creemos las políticas de seguridad.

### Paso 5: Crea las políticas de seguridad
Podemos crear la política de seguridad directamente desde el editor SQL de Supabase:

```sql
CREATE POLICY "Allow access only to owner"
ON public.YOUR_TABLE_NAME
FOR ALL -- Válido para SELECT, INSERT, UPDATE, DELETE
TO authenticated -- Se aplica solo a usuarios autenticados
USING (auth.uid() = user_id) 
WITH CHECK (auth.uid() = user_id); 
```

Con esta política activa, la base de datos muestra de forma segura las filas de la tabla solo a sus legítimos propietarios.
