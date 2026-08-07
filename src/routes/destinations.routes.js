const express = require('express');
const router = express.Router();
const db = require('../config/db'); // tu conexión MySQL

// ── GET TODOS LOS DESTINOS ──
router.get('/', async (req, res) => {
  try {
    const query = `
      SELECT id, name, region, lat, lng, aliases, active 
      FROM destinations 
      WHERE active = TRUE 
      ORDER BY name ASC
    `;
    const [results] = await db.promise().query(query);
    
    // Parse aliases (JSON)
    const destinations = results.map(d => ({
      ...d,
      aliases: d.aliases ? JSON.parse(d.aliases) : []
    }));

    res.json({ success: true, data: destinations });
  } catch (error) {
    console.error('Error fetching destinations:', error);
    res.status(500).json({ success: false, message: 'Error fetching destinations' });
  }
});

// ── BUSCAR DESTINOS POR NOMBRE O ALIAS ──
router.get('/search/:query', async (req, res) => {
  try {
    const searchTerm = `%${req.params.query}%`;
    const query = `
      SELECT id, name, region, lat, lng, aliases, active 
      FROM destinations 
      WHERE active = TRUE 
      AND (name LIKE ? OR aliases LIKE ?)
      ORDER BY name ASC
    `;
    const [results] = await db.promise().query(query, [searchTerm, searchTerm]);
    
    const destinations = results.map(d => ({
      ...d,
      aliases: d.aliases ? JSON.parse(d.aliases) : []
    }));

    res.json({ success: true, data: destinations });
  } catch (error) {
    console.error('Error searching destinations:', error);
    res.status(500).json({ success: false, message: 'Error searching destinations' });
  }
});

// ── GET UN DESTINO POR ID ──
router.get('/:id', async (req, res) => {
  try {
    const query = `
      SELECT id, name, region, lat, lng, aliases, active 
      FROM destinations 
      WHERE id = ?
    `;
    const [results] = await db.promise().query(query, [req.params.id]);
    
    if (results.length === 0) {
      return res.status(404).json({ success: false, message: 'Destination not found' });
    }

    const destination = {
      ...results[0],
      aliases: results[0].aliases ? JSON.parse(results[0].aliases) : []
    };

    res.json({ success: true, data: destination });
  } catch (error) {
    console.error('Error fetching destination:', error);
    res.status(500).json({ success: false, message: 'Error fetching destination' });
  }
});

// ── CREAR DESTINO (ADMIN) ──
router.post('/', async (req, res) => {
  try {
    const { name, region, lat, lng, aliases } = req.body;

    if (!name || lat === undefined || lng === undefined) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    const aliasesJson = Array.isArray(aliases) ? JSON.stringify(aliases) : null;

    const query = `
      INSERT INTO destinations (name, region, lat, lng, aliases, active)
      VALUES (?, ?, ?, ?, ?, TRUE)
    `;
    const [result] = await db.promise().query(query, [name, region, lat, lng, aliasesJson]);

    res.json({
      success: true,
      message: 'Destination created successfully',
      id: result.insertId
    });
  } catch (error) {
    console.error('Error creating destination:', error);
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ success: false, message: 'Destination name already exists' });
    }
    res.status(500).json({ success: false, message: 'Error creating destination' });
  }
});

// ── ACTUALIZAR DESTINO (ADMIN) ──
router.patch('/:id', async (req, res) => {
  try {
    const { name, region, lat, lng, aliases, active } = req.body;
    const aliasesJson = Array.isArray(aliases) ? JSON.stringify(aliases) : null;

    const query = `
      UPDATE destinations 
      SET name = COALESCE(?, name),
          region = COALESCE(?, region),
          lat = COALESCE(?, lat),
          lng = COALESCE(?, lng),
          aliases = COALESCE(?, aliases),
          active = COALESCE(?, active)
      WHERE id = ?
    `;
    const [result] = await db.promise().query(query, [
      name || null,
      region || null,
      lat !== undefined ? lat : null,
      lng !== undefined ? lng : null,
      aliasesJson,
      active !== undefined ? active : null,
      req.params.id
    ]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Destination not found' });
    }

    res.json({ success: true, message: 'Destination updated successfully' });
  } catch (error) {
    console.error('Error updating destination:', error);
    res.status(500).json({ success: false, message: 'Error updating destination' });
  }
});

// ── ELIMINAR DESTINO (ADMIN) ──
router.delete('/:id', async (req, res) => {
  try {
    const query = 'UPDATE destinations SET active = FALSE WHERE id = ?';
    const [result] = await db.promise().query(query, [req.params.id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Destination not found' });
    }

    res.json({ success: true, message: 'Destination deleted successfully' });
  } catch (error) {
    console.error('Error deleting destination:', error);
    res.status(500).json({ success: false, message: 'Error deleting destination' });
  }
});

module.exports = router;