// ============================================================
// sockets/tracking.socket.js — VisitaRD
// Motor de tracking en tiempo real tipo Uber
// Conductor emite GPS → servidor rebroadcast a pasajeros
// ============================================================

const { Server } = require('socket.io');
const jwt         = require('jsonwebtoken');
const redis       = require('../config/redis');
const db          = require('../config/db');

let io;

// ── Helpers ──────────────────────────────────────────────────

/**
 * Verifica el JWT que viene en el handshake de Socket.io
 * Retorna el payload del token o lanza error
 */
function verifySocketToken(token) {
  if (!token) throw new Error('Sin token');
  return jwt.verify(token, process.env.JWT_SECRET);
}

/**
 * Calcula ETA estimado en minutos dado que el bus está en
 * (driverLat, driverLng) y el destino está en (destLat, destLng)
 * Fórmula simplificada Haversine + velocidad promedio 60km/h
 */
function calcETA(driverLat, driverLng, destLat, destLng, speedKmh = 60) {
  const R   = 6371; // radio tierra km
  const dLat = ((destLat - driverLat) * Math.PI) / 180;
  const dLng = ((destLng - driverLng) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((driverLat * Math.PI) / 180) *
      Math.cos((destLat * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const distKm = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const effectiveSpeed = speedKmh > 5 ? speedKmh : 60;
  return Math.round((distKm / effectiveSpeed) * 60); // en minutos
}

// ════════════════════════════════════════════════════════════
// INICIALIZACIÓN
// ════════════════════════════════════════════════════════════
function initSocket(server) {
  io = new Server(server, {
    cors: {
      origin: (process.env.ALLOWED_ORIGINS || '').split(',').map(o => o.trim()),
      methods: ['GET', 'POST'],
      credentials: true,
    },
    // Tiempo en ms antes de considerar al cliente desconectado
    pingTimeout: 20000,
    pingInterval: 10000,
  });

  // ── Middleware de autenticación Socket.io ─────────────────
  // Valida JWT en CADA conexión antes de aceptarla
  io.use((socket, next) => {
    try {
      const token =
        socket.handshake.auth?.token ||
        socket.handshake.headers?.authorization?.replace('Bearer ', '');

      const user = verifySocketToken(token);
      socket.user = user; // { id, role, name }
      next();
    } catch (err) {
      next(new Error('Autenticación Socket fallida: ' + err.message));
    }
  });

  // ── Conexión ──────────────────────────────────────────────
  io.on('connection', (socket) => {
    const { id: userId, role } = socket.user;
    console.log(`[Socket] Conectado: user=${userId} role=${role} socket=${socket.id}`);

    // ──────────────────────────────────────────────────────
    // CONDUCTOR: unirse a su viaje activo
    // ──────────────────────────────────────────────────────
    socket.on('driver:join_trip', async ({ trip_id }) => {
      try {
        if (role !== 'driver' && role !== 'admin') {
          return socket.emit('error', { message: 'Solo conductores pueden emitir ubicación' });
        }

        // Registrar socket del conductor en Redis
        await redis.set(
          `driver:socket:${userId}`,
          JSON.stringify({ socket_id: socket.id, trip_id }),
          { EX: 3600 }
        );

        socket.join(`trip:${trip_id}`);
        socket.join(`driver:${userId}`);

        console.log(`[Socket] Conductor ${userId} unido al viaje ${trip_id}`);
        socket.emit('driver:joined', { trip_id, message: 'Conectado al viaje' });

        // Notificar a pasajeros que el conductor se conectó
        socket.to(`trip:${trip_id}`).emit('trip:driver_connected', {
          trip_id,
          message: 'El conductor está en línea',
        });
      } catch (err) {
        console.error('[Socket driver:join_trip]', err.message);
        socket.emit('error', { message: 'Error al unirse al viaje' });
      }
    });

    // ──────────────────────────────────────────────────────
    // CONDUCTOR: enviar ubicación GPS (cada 3 segundos)
    // Este es el corazón del sistema tipo Uber
    // ──────────────────────────────────────────────────────
    socket.on('driver:update_location', async (data) => {
      try {
        const { trip_id, lat, lng, speed = 0, heading = 0 } = data;

        if (!trip_id || !lat || !lng) return;

        // 1. Guardar en Redis con TTL 30s (si conductor desaparece, expira solo)
        const locationData = {
          lat,
          lng,
          speed,
          heading,
          driver_id: userId,
          updated_at: new Date().toISOString(),
        };

        await redis.set(
          `trip:tracking:${trip_id}`,
          JSON.stringify(locationData),
          { EX: 30 }
        );

        // 2. Obtener destino del viaje para calcular ETA
        //    Se cachea también para no hacer query en cada update GPS
        let destLat, destLng;
        const cachedDest = await redis.get(`trip:dest:${trip_id}`);

        if (cachedDest) {
          const dest = JSON.parse(cachedDest);
          destLat = dest.lat;
          destLng = dest.lng;
        } else {
          const [rows] = await db.query(
            'SELECT dest_lat, dest_lng FROM trips WHERE id = ?',
            [trip_id]
          );
          if (rows.length) {
            destLat = rows[0].dest_lat;
            destLng = rows[0].dest_lng;
            // Cachear destino 1 hora
            await redis.set(
              `trip:dest:${trip_id}`,
              JSON.stringify({ lat: destLat, lng: destLng }),
              { EX: 3600 }
            );
          }
        }

        const eta = destLat
          ? calcETA(lat, lng, destLat, destLng, speed)
          : null;

        // 3. Broadcast a TODOS los pasajeros suscritos al viaje
        const payload = { trip_id, lat, lng, speed, heading, eta_minutes: eta };
        io.to(`trip:${trip_id}`).emit('trip:location_update', payload);

        // 4. Guardar en DB cada 30 segundos (no en cada update para no saturar MySQL)
        const now = Date.now();
        const lastDbSave = socket._lastDbSave || 0;
        if (now - lastDbSave > 30000) {
          socket._lastDbSave = now;
          await db.query(
            `INSERT INTO tracking (trip_id, driver_id, current_lat, current_lng, speed, heading)
             VALUES (?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
               current_lat = VALUES(current_lat),
               current_lng = VALUES(current_lng),
               speed       = VALUES(speed),
               heading     = VALUES(heading),
               updated_at  = NOW()`,
            [trip_id, userId, lat, lng, speed, heading]
          );
        }

        // 5. Alerta si el bus está a menos de 5 minutos de llegar
        if (eta !== null && eta <= 5 && eta > 0) {
          io.to(`trip:${trip_id}`).emit('trip:arriving_soon', {
            trip_id,
            eta_minutes: eta,
            message: `El bus llega en ${eta} minutos`,
          });
        }

      } catch (err) {
        console.error('[Socket driver:update_location]', err.message);
      }
    });

    // ──────────────────────────────────────────────────────
    // CONDUCTOR: cambiar estado del viaje
    // boarding → in_progress → completed
    // ──────────────────────────────────────────────────────
    socket.on('driver:update_status', async ({ trip_id, status }) => {
      const validStatuses = ['boarding', 'in_progress', 'completed', 'cancelled'];
      if (!validStatuses.includes(status)) {
        return socket.emit('error', { message: 'Estado inválido' });
      }

      try {
        await db.query(
          'UPDATE trips SET status = ? WHERE id = ?',
          [status, trip_id]
        );

        // Notificar a todos los pasajeros del viaje
        io.to(`trip:${trip_id}`).emit('trip:status_changed', {
          trip_id,
          status,
          message: getStatusMessage(status),
          timestamp: new Date().toISOString(),
        });

        // Si el viaje completó, limpiar Redis
        if (status === 'completed' || status === 'cancelled') {
          await redis.del(`trip:tracking:${trip_id}`);
          await redis.del(`trip:dest:${trip_id}`);
          await redis.del(`driver:socket:${userId}`);
        }

        console.log(`[Socket] Viaje ${trip_id} → estado: ${status}`);
      } catch (err) {
        console.error('[Socket driver:update_status]', err.message);
      }
    });

    // ──────────────────────────────────────────────────────
    // PASAJERO: suscribirse a actualizaciones de un viaje
    // ──────────────────────────────────────────────────────
    socket.on('passenger:join_trip', async ({ trip_id }) => {
      try {
        socket.join(`trip:${trip_id}`);
        console.log(`[Socket] Pasajero ${userId} escuchando viaje ${trip_id}`);

        // Enviar última posición conocida del bus si existe
        const lastLocation = await redis.get(`trip:tracking:${trip_id}`);
        if (lastLocation) {
          socket.emit('trip:location_update', JSON.parse(lastLocation));
        }

        // Enviar estado actual del viaje
        const [rows] = await db.query(
          'SELECT status, departure_at, origin, destination FROM trips WHERE id = ?',
          [trip_id]
        );
        if (rows.length) {
          socket.emit('trip:current_status', {
            trip_id,
            ...rows[0],
          });
        }
      } catch (err) {
        console.error('[Socket passenger:join_trip]', err.message);
      }
    });

    // ──────────────────────────────────────────────────────
    // PASAJERO: dejar de escuchar un viaje
    // ──────────────────────────────────────────────────────
    socket.on('passenger:leave_trip', ({ trip_id }) => {
      socket.leave(`trip:${trip_id}`);
    });

    // ──────────────────────────────────────────────────────
    // ADMIN: obtener snapshot de todos los viajes activos
    // ──────────────────────────────────────────────────────
    socket.on('admin:get_active_trips', async () => {
      if (role !== 'admin') return;
      try {
        const [trips] = await db.query(
          "SELECT id, origin, destination, status, departure_at FROM trips WHERE status IN ('boarding','in_progress')"
        );

        // Para cada viaje, obtener última posición de Redis
        const tripsWithLocation = await Promise.all(
          trips.map(async (trip) => {
            const loc = await redis.get(`trip:tracking:${trip.id}`);
            return { ...trip, location: loc ? JSON.parse(loc) : null };
          })
        );

        socket.emit('admin:active_trips', { trips: tripsWithLocation });
      } catch (err) {
        console.error('[Socket admin:get_active_trips]', err.message);
      }
    });

    // ──────────────────────────────────────────────────────
    // DESCONEXIÓN
    // ──────────────────────────────────────────────────────
    socket.on('disconnect', async (reason) => {
      console.log(`[Socket] Desconectado: user=${userId} reason=${reason}`);

      // Si era conductor, notificar a pasajeros
      if (role === 'driver') {
        try {
          const driverInfo = await redis.get(`driver:socket:${userId}`);
          if (driverInfo) {
            const { trip_id } = JSON.parse(driverInfo);
            io.to(`trip:${trip_id}`).emit('trip:driver_disconnected', {
              trip_id,
              message: 'El conductor perdió conexión temporalmente',
            });
            await redis.del(`driver:socket:${userId}`);
          }
        } catch (err) {
          console.error('[Socket disconnect cleanup]', err.message);
        }
      }
    });
  });

  console.log('[Socket.io] Inicializado correctamente');
  return io;
}

// ── Mensajes de estado ────────────────────────────────────────
function getStatusMessage(status) {
  const messages = {
    boarding:    'El bus está abordando pasajeros',
    in_progress: 'El viaje está en camino',
    completed:   'El viaje ha llegado a su destino',
    cancelled:   'El viaje fue cancelado',
  };
  return messages[status] || status;
}

// ── Exportar io para usar en otros lugares del backend ────────
function getIO() {
  if (!io) throw new Error('Socket.io no está inicializado');
  return io;
}

module.exports = { initSocket, getIO };
