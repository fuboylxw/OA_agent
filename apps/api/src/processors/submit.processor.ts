import { Process, Processor } from '@nestjs/bull';
import { Job } from 'bull';
import { Injectable } from '@nestjs/common';
import { SubmissionService } from '../modules/submission/submission.service';

@Processor('submit')
@Injectable()
export class SubmitProcessor {
  constructor(private readonly submissionService: SubmissionService) {}

  @Process('execute')
  async handleSubmit(job: Job) {
    return this.submissionService.executeSubmission(job.data);
  }
}
