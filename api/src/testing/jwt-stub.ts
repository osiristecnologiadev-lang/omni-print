// Test-only stand-in for @nestjs/jwt, wired via moduleNameMapper in
// package.json's jest config. The installed @nestjs/jwt version's compiled
// dist fails to load under this Jest/ts-jest combination ("Must use import
// to load ES Module", then a broken jsonwebtoken re-export once forced
// through the transformer) - a real dependency-compatibility issue, not
// something in this project's own code. UserAuthGuard only needs
// JwtService's shape for typing/DI-token identity in tests (the real
// verifyAsync is always mocked anyway), so this stub is enough to test the
// guard's own logic without loading the real package at all.
export class JwtService {
  async signAsync(..._args: unknown[]): Promise<string> {
    throw new Error('JwtService stub used outside a test - mock it explicitly');
  }
  async verifyAsync<T = unknown>(..._args: unknown[]): Promise<T> {
    throw new Error('JwtService stub used outside a test - mock it explicitly');
  }
}
