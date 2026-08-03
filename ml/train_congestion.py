#!/usr/bin/env python3
# ============================================================
# train_congestion.py — VisitaRD ML · Predicción de Congestión
# Entrena modelo y genera predicciones para próximas 24h
# Deploy: Railway cron job — ejecutar cada hora
# ============================================================

import pandas as pd
import numpy as np
from sklearn.ensemble import RandomForestRegressor
from sklearn.preprocessing import LabelEncoder
import joblib
import mysql.connector
import json
import redis
from datetime import datetime, timedelta
import os
import sys

# ════════════════════════════════════════════════════════════
# CONFIG
# ════════════════════════════════════════════════════════════

DB_CONFIG = {
    'host': os.getenv('DB_HOST', 'localhost'),
    'user': os.getenv('DB_USER', 'root'),
    'password': os.getenv('DB_PASSWORD', ''),
    'database': os.getenv('DB_NAME', 'railway')
}

REDIS_URL = os.getenv('REDIS_URL', 'redis://localhost:6379')
MODEL_PATH = '/tmp/congestion_model.pkl'
ENCODER_PATH = '/tmp/beach_encoder.pkl'

# ════════════════════════════════════════════════════════════
# CONEXIONES
# ════════════════════════════════════════════════════════════

def get_db_connection():
    """Conectar a MySQL"""
    try:
        return mysql.connector.connect(**DB_CONFIG)
    except Exception as e:
        print(f"❌ Error conectar MySQL: {e}")
        return None

def get_redis_connection():
    """Conectar a Redis"""
    try:
        return redis.from_url(REDIS_URL, decode_responses=True)
    except Exception as e:
        print(f"⚠️  Error conectar Redis: {e}")
        return None

# ════════════════════════════════════════════════════════════
# DATA COLLECTION
# ════════════════════════════════════════════════════════════

def get_real_data():
    """Traer datos REALES de beach_checkins si existen"""
    print("📊 Buscando datos reales de beach_checkins...")
    
    conn = get_db_connection()
    if not conn:
        return pd.DataFrame()
    
    try:
        cursor = conn.cursor(dictionary=True)
        
        query = """
        SELECT 
            beach_id,
            HOUR(checkin_time) as hour,
            DAYOFWEEK(checkin_time) - 1 as day_of_week,
            MONTH(checkin_time) as month,
            COUNT(*) as users
        FROM beach_checkins
        WHERE checkin_time >= DATE_SUB(NOW(), INTERVAL 90 DAY)
        GROUP BY beach_id, HOUR(checkin_time), DAYOFWEEK(checkin_time), MONTH(checkin_time)
        """
        
        cursor.execute(query)
        results = cursor.fetchall()
        cursor.close()
        
        if results:
            print(f"✅ Encontrados {len(results)} registros reales")
            return pd.DataFrame(results)
        else:
            print("⚠️  No hay datos reales, usando datos sintéticos")
            return generate_synthetic_data()
    
    except Exception as e:
        print(f"❌ Error traer datos: {e}")
        return generate_synthetic_data()
    
    finally:
        conn.close()

def generate_synthetic_data():
    """Generar datos sintéticos para MVP"""
    print("📊 Generando datos sintéticos...")
    
    conn = get_db_connection()
    if not conn:
        print("❌ No se puede conectar a BD para traer playas")
        return pd.DataFrame()
    
    try:
        cursor = conn.cursor(dictionary=True)
        cursor.execute('SELECT id FROM beaches')
        beaches = [row['id'] for row in cursor.fetchall()]
        cursor.close()
    except Exception as e:
        print(f"❌ Error traer playas: {e}")
        return pd.DataFrame()
    finally:
        conn.close()
    
    if not beaches:
        print("❌ No hay playas registradas")
        return pd.DataFrame()
    
    # Generar 500 datos sintéticos realistas
    data = []
    for _ in range(500):
        beach_id = np.random.choice(beaches)
        hour = np.random.randint(0, 24)
        day_of_week = np.random.randint(0, 7)
        month = np.random.randint(1, 13)
        
        # Patrón: más gente a mediodía
        base_users = 50
        if 11 <= hour <= 16:
            users = int(base_users * np.random.uniform(2.0, 3.5))
        elif 7 <= hour < 11 or 16 < hour <= 19:
            users = int(base_users * np.random.uniform(1.0, 2.0))
        else:
            users = int(base_users * np.random.uniform(0.1, 0.8))
        
        data.append({
            'beach_id': beach_id,
            'hour': hour,
            'day_of_week': day_of_week,
            'month': month,
            'users': max(0, users)
        })
    
    print(f"📊 Generados {len(data)} datos sintéticos")
    return pd.DataFrame(data)

# ════════════════════════════════════════════════════════════
# MODEL TRAINING
# ════════════════════════════════════════════════════════════

def train_model(df):
    """Entrenar RandomForest"""
    print("🧠 Entrenando modelo...")
    
    if df.empty:
        print("❌ DataFrame vacío, no hay datos para entrenar")
        return None, None
    
    try:
        # Encodear beach_id
        le = LabelEncoder()
        df['beach_encoded'] = le.fit_transform(df['beach_id'])
        
        X = df[['beach_encoded', 'hour', 'day_of_week', 'month']]
        y = df['users']
        
        model = RandomForestRegressor(
            n_estimators=100,
            max_depth=10,
            random_state=42,
            n_jobs=-1
        )
        model.fit(X, y)
        
        score = model.score(X, y)
        print(f"✅ Modelo entrenado (R² score: {score:.3f})")
        
        return model, le
    
    except Exception as e:
        print(f"❌ Error entrenar modelo: {e}")
        return None, None

# ════════════════════════════════════════════════════════════
// PREDICTIONS
// ════════════════════════════════════════════════════════════

def predict_congestion(model, le):
    """Generar predicciones próximas 24h"""
    print("🔮 Generando predicciones...")
    
    if model is None:
        print("❌ No hay modelo para predecir")
        return []
    
    conn = get_db_connection()
    if not conn:
        return []
    
    try:
        cursor = conn.cursor(dictionary=True)
        cursor.execute('SELECT id, capacity FROM beaches')
        beaches = cursor.fetchall()
        cursor.close()
    except Exception as e:
        print(f"❌ Error traer playas: {e}")
        return []
    finally:
        conn.close()
    
    predictions = []
    now = datetime.now()
    
    for beach in beaches:
        beach_id = beach['id']
        capacity = beach['capacity']
        beach_encoded = le.transform([beach_id])[0]
        
        for hour_offset in range(24):
            future_time = now + timedelta(hours=hour_offset)
            
            features = np.array([[
                beach_encoded,
                future_time.hour,
                future_time.weekday(),
                future_time.month
            ]])
            
            predicted_users = max(0, int(model.predict(features)[0]))
            congestion_pct = min(100, (predicted_users / capacity) * 100)
            
            # Clasificar nivel
            if congestion_pct < 30:
                level = 'green'
            elif congestion_pct < 70:
                level = 'yellow'
            else:
                level = 'red'
            
            predictions.append({
                'beach_id': beach_id,
                'prediction_hour': future_time,
                'predicted_congestion': round(congestion_pct, 2),
                'predicted_users': predicted_users,
                'level': level
            })
    
    print(f"🔮 {len(predictions)} predicciones generadas")
    return predictions

# ════════════════════════════════════════════════════════════
// SAVE DATA
// ════════════════════════════════════════════════════════════

def save_to_database(predictions):
    """Guardar en MySQL"""
    print("💾 Guardando predicciones en MySQL...")
    
    if not predictions:
        print("❌ No hay predicciones para guardar")
        return
    
    conn = get_db_connection()
    if not conn:
        return
    
    try:
        cursor = conn.cursor()
        
        # Limpiar predicciones viejas
        cursor.execute(
            'DELETE FROM beach_predictions WHERE prediction_hour < DATE_SUB(NOW(), INTERVAL 24 HOUR)'
        )
        deleted = cursor.rowcount
        
        # Insertar nuevas
        for pred in predictions:
            cursor.execute("""
                INSERT INTO beach_predictions 
                (beach_id, prediction_hour, predicted_congestion, predicted_users, level, created_at)
                VALUES (%s, %s, %s, %s, %s, NOW())
            """, (
                pred['beach_id'],
                pred['prediction_hour'],
                pred['predicted_congestion'],
                pred['predicted_users'],
                pred['level']
            ))
        
        conn.commit()
        print(f"✅ {len(predictions)} predicciones guardadas (eliminadas {deleted} antiguas)")
    
    except Exception as e:
        print(f"❌ Error guardar en MySQL: {e}")
    
    finally:
        cursor.close()
        conn.close()

def save_to_redis(predictions):
    """Guardar en Redis para cache rápido"""
    print("⚡ Guardando en Redis...")
    
    if not predictions:
        print("⚠️  No hay predicciones para Redis")
        return
    
    r = get_redis_connection()
    if not r:
        return
    
    try:
        # Agrupar por playa
        by_beach = {}
        for pred in predictions:
            beach_id = pred['beach_id']
            if beach_id not in by_beach:
                by_beach[beach_id] = []
            by_beach[beach_id].append(pred)
        
        # Guardar cada playa
        for beach_id, beach_preds in by_beach.items():
            key = f'beach_predictions:{beach_id}'
            r.set(key, json.dumps(beach_preds, default=str), ex=3600)
        
        print(f"⚡ {len(by_beach)} playas guardadas en Redis")
    
    except Exception as e:
        print(f"⚠️  Error Redis: {e}")

# ════════════════════════════════════════════════════════════
// MAIN
// ════════════════════════════════════════════════════════════

def main():
    """Pipeline completo"""
    print("=" * 60)
    print("🚀 PREDICCIÓN DE CONGESTIÓN — VISITARD ML")
    print(f"⏰ {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 60)
    
    try:
        # 1. Traer datos
        df = get_real_data()
        
        if df.empty:
            print("❌ Sin datos para entrenar")
            return 1
        
        # 2. Entrenar modelo
        model, le = train_model(df)
        
        if model is None:
            print("❌ Error al entrenar modelo")
            return 1
        
        # 3. Generar predicciones
        predictions = predict_congestion(model, le)
        
        if not predictions:
            print("❌ Sin predicciones generadas")
            return 1
        
        # 4. Guardar en MySQL
        save_to_database(predictions)
        
        # 5. Guardar en Redis
        save_to_redis(predictions)
        
        print("=" * 60)
        print("✨ PROCESO COMPLETADO EXITOSAMENTE")
        print("=" * 60)
        return 0
    
    except Exception as e:
        print(f"❌ ERROR CRÍTICO: {e}")
        import traceback
        traceback.print_exc()
        return 1

if __name__ == '__main__':
    sys.exit(main())
