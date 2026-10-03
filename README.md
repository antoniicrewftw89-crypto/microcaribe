# MicroCaribe

Aplicación para gestionar microcréditos diarios ("gota a gota") que **funciona sin internet**.
Proyecto de Ingeniería de Requerimientos, Universidad de Cartagena.

- Clientes con GPS, préstamos con tabla de cuotas, pagos con recibo, cartera del día, mora, ruta por cercanía, cuadre de caja y gastos.
- Datos cifrados en el dispositivo con un PIN. Se instala como app (PWA).
- Sincronización diferida con una copia de respaldo en la nube (necesita `server.js`).

## Usarla

Abre la dirección publicada con GitHub Pages desde el celular o el computador e instálala desde el navegador.
La sincronización con la nube solo funciona con el servidor local (ver abajo).

## Correrla en el computador (con sincronización)

Requiere Node.js.

```
node server.js
```

Abre http://localhost:3000

## Pruebas

```
npm test
```
