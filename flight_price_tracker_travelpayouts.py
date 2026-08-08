#!/usr/bin/env python3
"""
flight_price_tracker_travelpayouts.py

Rastrea precios de vuelos usando la Travelpayouts Data API (Aviasales)
y guarda un historial local en CSV para ver la evolución de precios.

USO CON CLAUDE CODE
--------------------
IMPORTANTE: Los datos vienen de CACHÉ (2-7 días de historial de búsquedas reales).
No son precios en vivo, sino tendencias. Ideal para monitorear si el precio
bajó recientemente, no para comprar en el segundo exacto.

1. Registrate en https://www.travelpayouts.com y conseguí tu token de la
   Data API.

2. Exportá el token como variable de entorno antes de correr el script:
       export TRAVELPAYOUTS_API_TOKEN="tu_token_aca"

3. Corré el script:
       python3 flight_price_tracker_travelpayouts.py

4. Los precios y el historial se guardarán en `flight_price_history.csv`
   en la misma carpeta donde está el script.

CONFIGURACIÓN
--------------
Las rutas a trackear están en la lista ROUTES abajo. Editá esa lista para
agregar/sacar rutas o cambiar umbrales de precio (max_price).

Las fechas se buscan por MES (formato YYYY-MM). Podés ajustar SEARCH_MONTHS
para cambiar cuántos meses a futuro rastrear.
"""

import os
import csv
import sys
from datetime import datetime
from dateutil.relativedelta import relativedelta

import requests

# ---------------------------------------------------------------------------
# CONFIGURACIÓN
# ---------------------------------------------------------------------------

# Token de Travelpayouts (se lee de la variable de entorno, nunca hardcodeado)
API_TOKEN = os.environ.get("TRAVELPAYOUTS_API_TOKEN")
BASE_URL = "https://api.travelpayouts.com/v1/prices/cheap"

# Rutas a trackear (códigos IATA de ciudades)
ROUTES = [
    {"name": "Londres → Ciudad de México", "fly_from": "LON", "fly_to": "MEX", "max_price": None},
    {"name": "Londres → Bilbao",           "fly_from": "LON", "fly_to": "BIO", "max_price": None},
    {"name": "Londres → Madrid",           "fly_from": "LON", "fly_to": "MAD", "max_price": None},
    {"name": "Londres → París",            "fly_from": "LON", "fly_to": "PAR", "max_price": None},
]

# Cuántos meses a futuro rastrear (desde ahora)
SEARCH_MONTHS = 4

CURRENCY = "GBP"

LOG_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "flight_price_history.csv")

# Nota importante sobre Travelpayouts
CACHE_NOTE = (
    "⚠️  NOTA: Los precios vienen de CACHÉ (datos de búsquedas reales de 2-7 días atrás).\n"
    "   No son precios en vivo. Ideal para ver tendencias, no para comprar en el segundo exacto.\n"
)


# ---------------------------------------------------------------------------
# LÓGICA
# ---------------------------------------------------------------------------

def check_api_token():
    if not API_TOKEN:
        print("ERROR: no encontré la variable de entorno TRAVELPAYOUTS_API_TOKEN.")
        print('Corré: export TRAVELPAYOUTS_API_TOKEN="tu_token_aca"')
        sys.exit(1)


def search_route(route):
    """
    Busca vuelos para una ruta usando Travelpayouts Data API.
    La API devuelve un ticket barato por mes.
    """
    flights = []

    # Buscamos para los próximos N meses
    now = datetime.now()
    for month_offset in range(SEARCH_MONTHS):
        search_date = now + relativedelta(months=month_offset)
        depart_date = search_date.strftime("%Y-%m")

        params = {
            "origin": route["fly_from"],
            "destination": route["fly_to"],
            "depart_date": depart_date,
            "currency": CURRENCY,
            "token": API_TOKEN,
        }

        try:
            resp = requests.get(BASE_URL, params=params, timeout=20)
            resp.raise_for_status()
        except requests.exceptions.RequestException as e:
            print(f"  ⚠️  Error consultando {route['name']} para {depart_date}: {e}")
            continue

        data = resp.json()

        # La estructura de Travelpayouts: data -> destino -> cantidad de escalas -> oferta
        if data.get("success") and data.get("data"):
            for dest_code, offers_by_stops in data["data"].items():
                if not isinstance(offers_by_stops, dict):
                    continue
                for stops, flight_info in offers_by_stops.items():
                    if isinstance(flight_info, dict):
                        flights.append(flight_info)

    return flights


def log_result(route, flight):
    """Agrega una fila al historial CSV."""
    file_exists = os.path.isfile(LOG_FILE)
    with open(LOG_FILE, "a", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        if not file_exists:
            writer.writerow([
                "timestamp", "route", "price", "currency",
                "departure_date", "return_date", "airline", "flight_number",
                "ticket_link", "data_source"
            ])

        writer.writerow([
            datetime.now().isoformat(timespec="seconds"),
            route["name"],
            flight.get("price"),
            CURRENCY,
            flight.get("departure_at", ""),
            flight.get("return_at", ""),
            flight.get("airline", ""),
            flight.get("flight_number", ""),
            flight.get("link", ""),
            "Travelpayouts (cache)",
        ])


def main():
    check_api_token()
    print(CACHE_NOTE)
    print(f"Rastreando {len(ROUTES)} rutas — {datetime.now().strftime('%Y-%m-%d %H:%M')}\n")

    for route in ROUTES:
        print(f"🔎 {route['name']}")
        flights = search_route(route)

        if not flights:
            print(f"  (sin resultados en caché para los próximos {SEARCH_MONTHS} meses)")
            print()
            continue

        for flight in flights:
            price = flight.get("price")
            log_result(route, flight)

            alert = ""
            if route["max_price"] and price is not None and price <= route["max_price"]:
                alert = "  🔥 ¡BAJO TU UMBRAL!"

            dep = flight.get("departure_at", "")[:10] if flight.get("departure_at") else "N/A"
            airline = flight.get("airline", "?")
            print(f"   {price} {CURRENCY} | {airline} | sale {dep}{alert}")

        print()

    print(f"✅ Historial guardado en: {LOG_FILE}")


if __name__ == "__main__":
    main()
