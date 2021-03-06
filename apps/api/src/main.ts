/**
 * This is not a production server yet!
 * This is only a minimal backend to get started.
 */

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app/app.module';
import { environment } from './environments/environment';

async function bootstrap() {
    const app = await NestFactory.create(AppModule);
    app.enableCors({ origin: environment.clientUrl });
    const port = process.env.PORT || 3333;
    await app.listen(port, () => {
        Logger.log('Listening at http://localhost:' + port, 'main.ts');
    });
}

bootstrap().catch(err => console.error(err));
