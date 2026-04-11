import { Process, Processor } from '@nestjs/bull';
import { Job } from 'bull';
import { Injectable } from '@nestjs/common';
import { WebhookService } from '../modules/webhook/webhook.service';

@Processor('webhook')
@Injectable()
export class WebhookProcessor {
  constructor(private readonly webhookService: WebhookService) {}

  @Process('process')
  async handleWebhook(job: Job<{ inboxId: string }>) {
    return this.webhookService.processInbox(job.data.inboxId);
  }
}
