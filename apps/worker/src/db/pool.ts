import pg from "pg";

export function createPool(connectionString: string): pg.Pool {
  const pool = new pg.Pool({ connectionString, max: 5 });
  // Un error en un cliente inactivo no debe tumbar el proceso.
  pool.on("error", (err) => {
    console.error(JSON.stringify({ level: "error", msg: "Error en cliente inactivo de pg", error: err.message }));
  });
  return pool;
}
