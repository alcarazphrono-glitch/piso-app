// Traduce errores de Supabase (auth y funciones de Postgres) a un mensaje
// que un usuario sí entiende. Ojo: los errores de PostgREST NO son
// instancias de Error (son objetos { message, code, ... }), así que el
// patrón `e instanceof Error ? e.message : "genérico"` siempre caía al
// genérico -- por ejemplo, "saldo insuficiente" se mostraba como "Intenta
// de nuevo", y la gente reintentaba algo que nunca iba a pasar.

const REGLAS: [RegExp, string][] = [
  // Auth
  [/invalid login credentials/i, "Correo o contraseña incorrectos."],
  [/user already registered|already been registered/i, "Ese correo ya tiene cuenta. Toca \"Ya tengo cuenta\" para entrar."],
  [/password should be at least/i, "La contraseña necesita al menos 6 caracteres."],
  [/unable to validate email|invalid email/i, "Ese correo no parece válido."],
  [/email not confirmed/i, "Confirma tu correo antes de entrar."],
  [/rate limit|too many requests/i, "Demasiados intentos. Espera un minuto y vuelve a intentar."],
  // Boletos y posiciones (mensajes de las funciones en supabase/migrations)
  [/saldo insuficiente/i, "No te alcanza el saldo para este boleto. Prueba con un nivel más chico."],
  [/ya tienes una posici[oó]n/i, "Ya estás dentro de este evento."],
  [/no est[aá] aceptando boletos|ya pas[oó] su fecha l[ií]mite/i, "Este nivel ya cerró. Elige otro."],
  [/no est[aá] abierto a nuevas posiciones/i, "Este evento ya cerró."],
  [/kill switch/i, "Por ahora no estamos aceptando entradas nuevas. Vuelve a intentar más tarde."],
  [/requiere sesi[oó]n activa|jwt/i, "Tu sesión expiró. Vuelve a entrar."],
  [/failed to fetch|network/i, "Sin conexión. Revisa tu internet y vuelve a intentar."],
];

export function mensajeParaUsuario(e: unknown, generico = "Algo salió mal. Intenta de nuevo."): string {
  const texto =
    typeof e === "string"
      ? e
      : e && typeof e === "object" && "message" in e && typeof (e as { message: unknown }).message === "string"
        ? (e as { message: string }).message
        : "";
  for (const [patron, mensaje] of REGLAS) {
    if (patron.test(texto)) return mensaje;
  }
  return generico;
}
