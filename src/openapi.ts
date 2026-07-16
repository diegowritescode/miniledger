import { type INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export function setupOpenApi(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('MiniLedger API')
    .setDescription(
      'A double-entry financial ledger — idempotent transfers, concurrency-safe balances, and an ' +
        'immutable, tamper-evident audit trail. Authenticated and authorized through AccessCore.',
    )
    .setVersion('0.1.0')
    .addServer('http://localhost:3000', 'Local')
    .addServer('https://ledger.deviego.xyz', 'Live')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'access-token')
    .addTag('accounts', 'Open and read ledger accounts')
    .addTag('transfers', 'Move money between accounts (idempotent)')
    .addTag('reversals', 'Compensate a posted transaction')
    .addTag('audit', 'Verify the hash chain and conservation of money')
    .addTag('health', 'Liveness, readiness, and metrics')
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, config));
}
