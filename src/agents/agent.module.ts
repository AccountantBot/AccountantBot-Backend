import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AgentService } from './agent.service';
import OpenAI from "openai";

@Module({
  imports: [ConfigModule],
  providers: [
    AgentService,
    {
      provide: "OPENAI",
      useFactory: () => new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
      }),
    }
  ],
  exports: [AgentService],
})
export class AgentModule {}
