import neo4j, { type Driver, type Session } from "neo4j-driver";

let driver: Driver | null = null;

export function getCognoEnv(): {
  uri: string;
  username: string;
  password: string;
} | null {
  const uri = process.env.COGNODB_URI ?? process.env.NEO4J_URI ?? "";
  const username = process.env.COGNODB_USERNAME ?? process.env.NEO4J_USERNAME ?? "";
  const password = process.env.COGNODB_PASSWORD ?? process.env.NEO4J_PASSWORD ?? "";
  if (!uri || !username || !password) return null;
  return { uri, username, password };
}

export function getDriver(): Driver {
  if (driver) return driver;
  const env = getCognoEnv();
  if (!env) {
    throw new Error(
      "The dependency graph is temporarily unavailable. Please try again."
    );
  }
  driver = neo4j.driver(env.uri, neo4j.auth.basic(env.username, env.password), {
    connectionTimeout: 60_000,
    connectionAcquisitionTimeout: 60_000,
    maxTransactionRetryTime: 60_000,
  });
  return driver;
}

export function getSession(database?: string): Session {
  const d = getDriver();
  return d.session(database ? { database } : undefined);
}

export async function verifyConnectivity(): Promise<void> {
  const d = getDriver();
  await d.verifyConnectivity();
}

export async function closeDriver(): Promise<void> {
  if (driver) {
    await driver.close();
    driver = null;
  }
}

// For testing / graceful shutdown
export function _resetDriver(): void {
  driver = null;
}
