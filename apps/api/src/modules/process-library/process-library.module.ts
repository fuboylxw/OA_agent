import { Module } from '@nestjs/common';
import { ProcessLibraryController } from './process-library.controller';
import { ProcessLibraryService } from './process-library.service';

@Module({
  controllers: [ProcessLibraryController],
  providers: [ProcessLibraryService],
  exports: [ProcessLibraryService],
})
export class ProcessLibraryModule {}
