import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import TelegramBot from 'node-telegram-bot-api';
import OpenAI from 'openai';

export interface TransactionRequest {
  amount: number;
  description?: string;
  participants: string[];
  splitType: 'equal' | 'custom';
  customAmounts?: Record<string, number>;
}

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);
  private bot: TelegramBot;

  constructor(
    @Inject('OPENAI') private readonly openai: OpenAI,
  ) {}

  /**
   * Analyzes a message to extract transaction details using OpenAI function calling
   * @param message The message text to analyze
   * @param groupMembers Optional list of group members for participant validation
   * @returns Transaction request details or null if no transaction detected
   */
  async analyzeMessage(
    message: string,
    groupMembers?: string[],
  ): Promise<TransactionRequest | null> {
    try {
      const functions: OpenAI.Chat.ChatCompletionCreateParams.Function[] = [
        {
          name: 'create_transaction',
          description:
            'Extract transaction details from a message about splitting payments or bills',
          parameters: {
            type: 'object',
            properties: {
              amount: {
                type: 'number',
                description: 'The total amount to be split or paid',
              },
              description: {
                type: 'string',
                description:
                  'Brief description of what the payment is for (e.g., Uber, dinner, hotel)',
              },
              participants: {
                type: 'array',
                items: { type: 'string' },
                description:
                  'List of participant names or usernames mentioned in the message',
              },
              splitType: {
                type: 'string',
                enum: ['equal'],
                description:
                  'Its ever "equal" since only equal split is supported now',
              },
              customAmounts: {
                type: 'object',
                description:
                  'Map of participant names to their custom amounts. REQUIRED when splitType is "custom". Each person gets their specified amount.',
                additionalProperties: { type: 'number' },
              },
            },
            required: ['amount', 'participants', 'splitType'],
          },
        },
      ];

      const systemPrompt = `Você é um assistente financeiro de um bot de Telegram. Sua função é analisar mensagens 
          de um grupo e identificar pedidos de divisão de conta.
          
          IMPORTANTE:
          - Se splitType for "equal", você DEVE calcular e preencher o campo "amountPerPerson" dividindo o valor total pelo número de participantes
          - Se splitType for "custom", você DEVE preencher o campo "customAmounts" com os valores específicos de cada pessoa mencionados na mensagem
          - Se a mensagem for uma conversa normal (ex: 'bom dia', 'obrigado'), não chame nenhuma função
          
          ${groupMembers ? `Membros do grupo disponíveis: ${groupMembers.join(', ')}` : ''}

          Se a mensagem não for sobre pagamentos ou divisão de contas, não chame nenhuma função.`;

      const response = await this.openai.chat.completions.create({
        model: 'gpt-5-nano',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: message },
        ],
        functions,
        function_call: 'auto',
      });

      const functionCall = response.choices[0]?.message?.function_call;

      if (!functionCall || functionCall.name !== 'create_transaction') {
        this.logger.debug('No transaction detected in message');
        return null;
      }

      const args = JSON.parse(functionCall.arguments) as TransactionRequest;
      this.logger.log(`Transaction detected: ${JSON.stringify(args)}`);

      return args;
    } catch (error) {
      this.logger.error('Error analyzing message with OpenAI', error);
      throw error;
    }
  }

  /**
   * Generates a human-friendly summary of a transaction
   * @param transaction The transaction request details
   * @returns A formatted summary string
   */
  async generateTransactionSummary(
    transaction: TransactionRequest,
  ): Promise<string> {
    try {
      const prompt = `Generate a brief, friendly message summarizing this transaction in Portuguese and max 400 characters:
        Valor total: ${transaction.amount}
        Descrição: ${transaction.description || 'Payment'}
        Participantes: ${transaction.participants.join(', ')}
        Divisão: ${transaction.splitType}
        ${transaction.customAmounts ? `Custom Amounts: ${JSON.stringify(transaction.customAmounts)}` : ''}

        Keep it conversational and under 100 words.`;

      const response = await this.openai.chat.completions.create({
        model: 'gpt-5-nano',
        messages: [{ role: 'user', content: prompt }],
      });

      return response.choices[0]?.message?.content || 'Transaction summary unavailable';
    } catch (error) {
      this.logger.error('Error generating transaction summary', error);
      throw error;
    }
  }

  generateTransactionSummaryWithData(
    transaction: TransactionRequest,
  ): string {
    
    let summary = `> *Você concorda?*\n`;
    summary += `💰 *Resumo da Divisão*\n\n`;
    summary += `📝 Descrição: ${transaction.description || 'Despesa'}\n`;
    summary += `💵 Valor Total: R$ ${transaction.amount.toFixed(2)}\n`;
    summary += `👥 Participantes: ${transaction.participants.join(', ')}\n`;
    summary += `📊 Igualmente\n`;
    summary += `Cada pessoa paga: R$ ${(transaction.amount / transaction.participants.length).toFixed(2)}\n`;

    return summary;
  }

  /**
   * Validates if mentioned participants exist in the group
   * @param participants List of participant names from the message
   * @param groupMembers List of actual group member names
   * @returns Object with valid and invalid participants
   */
  validateParticipants(
    participants: string[],
    groupMembers: string[],
  ): { valid: string[]; invalid: string[] } {
    const valid: string[] = [];
    const invalid: string[] = [];

    for (const participant of participants) {
      const normalized = participant.toLowerCase().trim();
      const found = groupMembers.find(
        (member) => member.toLowerCase().trim() === normalized,
      );

      if (found) {
        valid.push(found);
      } else {
        invalid.push(participant);
      }
    }

    return { valid, invalid };
  }
}