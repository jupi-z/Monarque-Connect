import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { importPKCS8, importSPKI, jwtVerify, SignJWT } from 'jose';
type ImportedKey = Awaited<ReturnType<typeof importPKCS8>>;

export interface AccessTokenClaims {
  sub: string;
  sid: string;
  jti: string;
}

@Injectable()
export class TokenService {
  private readonly issuer: string;
  private readonly audience: string;
  private readonly keyId: string;
  private readonly accessTtlSeconds: number;
  private readonly privateKeyPromise: Promise<ImportedKey>;
  private readonly publicKeyPromise: Promise<ImportedKey>;

  constructor(config: ConfigService) {
    this.issuer = config.getOrThrow<string>('JWT_ISSUER');
    this.audience = config.getOrThrow<string>('JWT_AUDIENCE');
    this.keyId = config.getOrThrow<string>('JWT_KEY_ID');
    this.accessTtlSeconds = Number(config.get<string>('JWT_ACCESS_TTL_SECONDS') ?? 900);
    if (!Number.isInteger(this.accessTtlSeconds) || this.accessTtlSeconds < 60 || this.accessTtlSeconds > 3600) {
      throw new Error('JWT_ACCESS_TTL_SECONDS must be an integer between 60 and 3600');
    }
    this.privateKeyPromise = importPKCS8(config.getOrThrow<string>('JWT_PRIVATE_KEY_PEM'), 'RS256');
    this.publicKeyPromise = importSPKI(config.getOrThrow<string>('JWT_PUBLIC_KEY_PEM'), 'RS256');
  }

  async signAccessToken(claims: AccessTokenClaims): Promise<string> {
    const privateKey = await this.privateKeyPromise;
    return new SignJWT({ sid: claims.sid })
      .setProtectedHeader({ alg: 'RS256', kid: this.keyId, typ: 'JWT' })
      .setSubject(claims.sub)
      .setJti(claims.jti)
      .setIssuer(this.issuer)
      .setAudience(this.audience)
      .setIssuedAt()
      .setExpirationTime(`${this.accessTtlSeconds}s`)
      .sign(privateKey);
  }

  async verifyAccessToken(token: string): Promise<AccessTokenClaims> {
    const publicKey = await this.publicKeyPromise;
    const result = await jwtVerify(token, publicKey, {
      issuer: this.issuer,
      audience: this.audience,
      algorithms: ['RS256'],
    });
    if (typeof result.payload.sub !== 'string' || typeof result.payload.sid !== 'string' || typeof result.payload.jti !== 'string') {
      throw new Error('Access token claims are incomplete');
    }
    return { sub: result.payload.sub, sid: result.payload.sid, jti: result.payload.jti };
  }
}
