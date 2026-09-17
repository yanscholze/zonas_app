from getpass import getpass
from datetime import date

from garminconnect import Garmin

email = input("E-mail Garmin: ")
password = getpass("Senha Garmin: ")

client = Garmin(
    email,
    password,
    prompt_mfa=lambda: input("Código MFA: "),
)

client.login("./tokenstore/teste")

today = date.today().isoformat()

print("LOGIN OK")
print(client.get_stats(today))