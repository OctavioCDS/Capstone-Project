# seed_visitas.py
#
# Script simple para crear visitas de prueba.
# Ejecutar con:
#   python manage.py shell < seed_visitas.py

from django.utils import timezone
from datetime import timedelta
import random

from personas.models import Persona
from visitas.models import Visita
from lugares.models import Lugar
from accounts.models import Usuario

# Cantidad de visitas a crear
TOTAL = 300

# Buscar un operador cualquiera
operador = Usuario.objects.filter(activo=True).order_by("id_usuario").first()
if not operador:
    print("No hay usuarios activos para usar como operador. Crea uno primero.")
else:
    print("Operador encontrado:", operador.nombre)

# Lugares disponibles
lugares = list(Lugar.objects.all())
print("Cantidad de lugares:", len(lugares))
if not lugares:
    print("No hay lugares en la base de datos. Crea lugares antes de correr este script.")
else:
    # Creamos visitas
    for i in range(TOTAL):
        # RUT ficticio (no necesariamente valido, es solo para pruebas)
        cuerpo = random.randint(10000000, 25999999)
        rut = f"{cuerpo}-0"  # dv fijo, para no complicar

        persona, _ = Persona.objects.get_or_create(
            run=rut,
            defaults={
                "nombres": f"Persona {i+1}",
                "apellidos": "Prueba",
                "is_inside": False,
            },
        )

        # Fecha de entrada en los ultimos 14 dias
        dias_atras = random.randint(0, 13)
        horas_atras = random.randint(0, 23)
        minutos_atras = random.randint(0, 59)
        entrada_at = timezone.now() - timedelta(
            days=dias_atras,
            hours=horas_atras,
            minutes=minutos_atras,
        )

        lugar = random.choice(lugares)

        visita = Visita.objects.create(
            persona=persona,
            lugar=lugar,
            entrada_at=entrada_at,
            operador_entrada=operador,
        )

        # 80% de las visitas tienen salida, 20% quedan "dentro"
        if random.random() < 0.8:
            minutos_duracion = random.randint(5, 240)
            salida_at = entrada_at + timedelta(minutes=minutos_duracion)
            visita.salida_at = salida_at
            visita.save(update_fields=["salida_at"])
            persona.is_inside = False
        else:
            persona.is_inside = True

        persona.save(update_fields=["is_inside"])

        # Mensaje cada 50 para ver avance
        if (i + 1) % 50 == 0:
            print(f"... creadas {i+1} visitas")

    print(f"Done: created {TOTAL} test visits (approx).")
