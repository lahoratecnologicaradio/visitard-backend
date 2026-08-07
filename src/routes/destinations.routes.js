const express = require('express');
const router = express.Router();
const db = require('../config/db');

// ── GET TODOS LOS DESTINOS ──
router.get('/', (req, res) => {
  const query = `
    SELECT id, name, region, lat, lng, aliases, active 
    FROM destinations 
    WHERE active = TRUE 
    ORDER BY name ASC
  `;
  
  db.query(query, (err, results) => {
    if (err) {
      console.error('Error fetching destinations:', err);
      return res.status(500).json({ success: false, message: 'Error fetching destinations', error: err.message });
    }
    
    // Parse aliases (JSON)
    const destinations = results.map(d => ({
      ...d,
      aliases: d.aliases ? JSON.parse(d.aliases) : []
    }));

    res.json({ success: true, data: destinations });
  });
});

// ── BUSCAR DESTINOS POR NOMBRE O ALIAS ──
router.get('/search/:query', (req, res) => {
  const searchTerm = `%${req.params.query}%`;
  const query = `
    SELECT id, name, region, lat, lng, aliases, active 
    FROM destinations 
    WHERE active = TRUE 
    AND (name LIKE ? OR aliases LIKE ?)
    ORDER BY name ASC
  `;
  
  db.query(query, [searchTerm, searchTerm], (err, results) => {
    if (err) {
      console.error('Error searching destinations:', err);
      return res.status(500).json({ success: false, message: 'Error searching destinations', error: err.message });
    }
    
    const destinations = results.map(d => ({
      ...d,
      aliases: d.aliases ? JSON.parse(d.aliases) : []
    }));

    res.json({ success: true, data: destinations });
  });
});

// ── GET UN DESTINO POR ID ──
router.get('/:id', (req, res) => {
  const query = `
    SELECT id, name, region, lat, lng, aliases, active 
    FROM destinations 
    WHERE id = ?
  `;
  
  db.query(query, [req.params.id], (err, results) => {
    if (err) {
      console.error('Error fetching destination:', err);
      return res.status(500).json({ success: false, message: 'Error fetching destination', error: err.message });
    }
    
    if (results.length === 0) {
      return res.status(404).json({ success: false, message: 'Destination not found' });
    }

    const destination = {
      ...results[0],
      aliases: results[0].aliases ? JSON.parse(results[0].aliases) : []
    };

    res.json({ success: true, data: destination });
  });
});

// ── CREAR DESTINO (ADMIN) ──
router.post('/', (req, res) => {
  const { name, region, lat, lng, aliases } = req.body;

  if (!name || lat === undefined || lng === undefined) {
    return res.status(400).json({ success: false, message: 'Missing required fields' });
  }

  const aliasesJson = Array.isArray(aliases) ? JSON.stringify(aliases) : null;

  const query = `
    INSERT INTO destinations (name, region, lat, lng, aliases, active)
    VALUES (?, ?, ?, ?, ?, TRUE)
  `;
  
  db.query(query, [name, region, lat, lng, aliasesJson], (err, result) => {
    if (err) {
      console.error('Error creating destination:', err);
      if (err.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ success: false, message: 'Destination name already exists' });
      }
      return res.status(500).json({ success: false, message: 'Error creating destination', error: err.message });
    }

    res.json({
      success: true,
      message: 'Destination created successfully',
      id: result.insertId
    });
  });
});

// ── ACTUALIZAR DESTINO (ADMIN) ──
router.patch('/:id', (req, res) => {
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
  
  db.query(query, [
    name || null,
    region || null,
    lat !== undefined ? lat : null,
    lng !== undefined ? lng : null,
    aliasesJson,
    active !== undefined ? active : null,
    req.params.id
  ], (err, result) => {
    if (err) {
      console.error('Error updating destination:', err);
      return res.status(500).json({ success: false, message: 'Error updating destination', error: err.message });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Destination not found' });
    }

    res.json({ success: true, message: 'Destination updated successfully' });
  });
});

// ── ELIMINAR DESTINO (ADMIN) ──
router.delete('/:id', (req, res) => {
  const query = 'UPDATE destinations SET active = FALSE WHERE id = ?';
  
  db.query(query, [req.params.id], (err, result) => {
    if (err) {
      console.error('Error deleting destination:', err);
      return res.status(500).json({ success: false, message: 'Error deleting destination', error: err.message });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Destination not found' });
    }

    res.json({ success: true, message: 'Destination deleted successfully' });
  });
});

module.exports = router;
