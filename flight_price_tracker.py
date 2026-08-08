#!/usr/bin/env python3
"""
flight_price_tracker.py

Rastrea precios de vuelos usando la API Tequila de Kiwi.com y guarda un
historial local en CSV para poder ver la evolución de precios en el tiempo.

USO CON CLAUDE CODE
--------------------
1. Registrate en https://tequila.kiwi.com y conseguí una API key.
   (Verificá vos mismo el estado actual de la cuota gratuita — el
   ecosistema de APIs de vuelos cambió bastante en 2026, ver nota
   en la conversación.)

2. Exportá la key como variable de entorno antes de correr el script:
       export TEQUILA_API_KEY="tu_api_key_aca"

3. Corré el script:
       python3 flight_price_tracker.py

4. Para que Claude Code lo corra automáticamente al iniciar sesión o de
   forma periódica, podés pedirle: "corré flight_price_tracker.py" al
   arrancar, o programarlo como tarea recurrente si tu setup lo permite.

CONFIGURACIÓN
--------------
Las rutas a trackear y los umbrales de precio están definidos en la
lista ROUTES más abajo. Editá esa lista para agregar, sacar o ajustar
rutas y precios límite.
"""

import os
import csv
import sys
from datetime import datetime, timedelta

import requests

# ---------------------------------------------------------------------------
# CONFIGURACIÓN
# ---------------------------------------------------------------------------

API_KEY = os.environ.get("TEQUILA_API_KEY")
BASE_URL = "https://tequila-api.kiwi.com/v2/search"

# Códigos de ciudad IATA (cubren todos los aeropuertos de esa ciudad)
ROUTES = [
    {"name": "Londres → Ciudad de México", "fly_from": "LON", "fly_to": "MEX", "max_price": None},
    {"name": "Londres → Bilbao",           "fly_from": "LON", "fly_to": "BIO", "max_price": None},
    {"name": "Londres → Madrid",           "fly_from": "LON", "fly_to": "MAD", "max_price": None},
    {"name": "Londres → París",            "fly_from": "LON", "fly_to": "PAR", "max_price": None},
]

# Ventana de búsqueda: desde X días a partir de hoy, hasta Y días
DAYS_FROM = 14
DAYS_TO = 120

CURRENCY = "GBP"
RESULTS_PER_ROUTE = 3  # cuántas opciones más baratas guardar por ruta

LOG_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "flight_price_history.csv")


# ---------------------------------------------------------------------------
# LÓGICA
# ---------------------------------------------------------------------------

def check_api_key():
    if not API_KEY:
        print("ERROR: no encontré la variable de entorno TEQUILA_API_KEY.")
        print('Corré: export TEQUILA_API_KEY="tu_api_key_aca"')
        sys.exit(1)


def search_route(route):
    """Busca vuelos para una ruta y devuelve las N opciones más baratas."""
    date_from = (datetime.today() + timedelta(days=DAYS_FROM)).strftime("%d/%m/%Y")
    date_to = (datetime.today() + timedelta(days=DAYS_TO)).strftime("%d/%m/%Y")

    params = {
        "fly_from": route["fly_from"],
        "fly_to": route["fly_to"],
        "date_from": date_from,
        "date_to": date_to,
        "curr": CURRENCY,
        "sort": "price",
        "limit": RESULTS_PER_ROUTE,
    }
    headers = {"apikey": API_KEY}

    try:
        resp = requests.get(BASE_URL, params=params, headers=headers, timeout=20)
        resp.raise_for_status()
    except requests.exceptions.RequestException as e:
        print(f"  ⚠️  Error consultando {route['name']}: {e}")
        return []

    data = resp.json()
    flights = data.get("data", [])
    if not flights:
        print(f"  (sin resultados para {route['name']} en esta ventana de fechas)")
    return flights


def log_result(route, flight):
    """Agrega una fila al historial CSV."""
    file_exists = os.path.isfile(LOG_FILE)
    with open(LOG_FILE, "a", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        if not file_exists:
            writer.writerow([
                "timestamp", "route", "price", "currency",
                "departure", "return", "airlines", "booking_token_deep_link"
            ])
        writer.writerow([
            datetime.now().isoformat(timespec="seconds"),
            route["name"],
            flight.get("price"),
            CURRENCY,
            flight.get("local_departure", ""),
            flight.get("local_arrival", ""),
            ",".join(flight.get("airlines", [])),
            flight.get("deep_link", ""),
        ])


def main():
    check_api_key()
    print(f"Rastreando {len(ROUTES)} rutas — {datetime.now().strftime('%Y-%m-%d %H:%M')}\n")

    for route in ROUTES:
        print(f"🔎 {route['name']}")
        flights = search_route(route)

        for flight in flights:
            price = flight.get("price")
            log_result(route, flight)

            alert = ""
            if route["max_price"] and price is not None and price <= route["max_price"]:
                alert = "  🔥 ¡BAJO TU UMBRAL!"

            dep = flight.get("local_departure", "")[:10]
            print(f"   {price} {CURRENCY} — sale {dep}{alert}")

        print()

    print(f"Historial guardado en: {LOG_FILE}")


if __name__ == "__main__":
    main()
