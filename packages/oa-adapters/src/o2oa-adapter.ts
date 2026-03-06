import axios, { AxiosInstance } from 'axios';
import {
  OAAdapter,
  DiscoverResult,
  HealthCheckResult,
  SubmitRequest,
  SubmitResult,
  StatusResult,
  CancelResult,
  UrgeResult,
} from './index';

export interface O2OAConfig {
  baseUrl: string;
  token?: string;
  credential?: string;
  password?: string;
}

export class O2OAAdapter implements OAAdapter {
  private client: AxiosInstance;
  private token?: string;

  constructor(private config: O2OAConfig) {
    this.client = axios.create({
      baseURL: config.baseUrl,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (config.token) {
      this.token = config.token;
      this.client.defaults.headers.common['x-token'] = config.token;
    }
  }

  /**
   * Authenticate with O2OA system
   */
  async authenticate(): Promise<string> {
    if (this.token) {
      return this.token;
    }

    if (!this.config.credential || !this.config.password) {
      throw new Error('Credential and password required for authentication');
    }

    const response = await this.client.post(
      '/x_organization_assemble_authentication/jaxrs/authentication',
      {
        credential: this.config.credential,
        password: this.config.password,
      },
    );

    if (response.data.type !== 'success') {
      throw new Error(`Authentication failed: ${response.data.message || 'Unknown error'}`);
    }

    this.token = response.data.data.token;
    this.client.defaults.headers.common['x-token'] = this.token;

    return this.token!;
  }

  /**
   * Discover O2OA applications and processes
   */
  async discover(): Promise<DiscoverResult> {
    await this.ensureAuthenticated();

    // Get application list
    const appsResponse = await this.client.get(
      '/x_processplatform_assemble_surface/jaxrs/application/list',
    );

    if (appsResponse.data.type !== 'success') {
      throw new Error(`Failed to get applications: ${appsResponse.data.message}`);
    }

    const applications = appsResponse.data.data || [];
    const discoveredFlows: Array<{
      flowCode: string;
      flowName: string;
      entryUrl?: string;
      submitUrl?: string;
      queryUrl?: string;
    }> = [];

    // Get processes for each application
    for (const app of applications) {
      try {
        const processResponse = await this.client.get(
          `/x_processplatform_assemble_surface/jaxrs/process/list/application/${app.id}`,
        );

        if (processResponse.data.type === 'success') {
          const processes = processResponse.data.data || [];
          for (const process of processes) {
            discoveredFlows.push({
              flowCode: process.id,
              flowName: process.name || process.alias || process.id,
              entryUrl: `/x_processplatform_assemble_surface/jaxrs/work/process/${process.id}`,
              submitUrl: `/x_processplatform_assemble_surface/jaxrs/work`,
              queryUrl: `/x_processplatform_assemble_surface/jaxrs/work`,
            });
          }
        }
      } catch (error) {
        console.warn(`[O2OAAdapter] Failed to get processes for app ${app.id}: ${error}`);
      }
    }

    return {
      oaVendor: 'O2OA',
      oaVersion: '8.0',
      oaType: 'hybrid',
      authType: 'apikey',
      discoveredFlows,
    };
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<HealthCheckResult> {
    const start = Date.now();
    try {
      const response = await this.client.get('/x_desktop/index.html', {
        timeout: 5000,
      });
      return {
        healthy: response.status === 200,
        latencyMs: Date.now() - start,
        message: 'O2OA is healthy',
      };
    } catch (error: any) {
      return {
        healthy: false,
        latencyMs: Date.now() - start,
        message: error.message,
      };
    }
  }

  /**
   * Submit a work to O2OA
   */
  async submit(request: SubmitRequest): Promise<SubmitResult> {
    await this.ensureAuthenticated();

    try {
      // Create work
      const createResponse = await this.client.post(
        '/x_processplatform_assemble_surface/jaxrs/work',
        {
          process: request.flowCode,
          title: request.formData.title || '新建工作',
          data: request.formData,
        },
      );

      if (createResponse.data.type !== 'success') {
        return {
          success: false,
          errorMessage: createResponse.data.message || 'Failed to create work',
        };
      }

      const workId = createResponse.data.data.id;

      // Process work (submit)
      const processResponse = await this.client.put(
        `/x_processplatform_assemble_surface/jaxrs/work/${workId}/process`,
        {
          routeName: '提交',
          opinion: request.formData.opinion || '',
        },
      );

      if (processResponse.data.type !== 'success') {
        return {
          success: false,
          submissionId: workId,
          errorMessage: processResponse.data.message || 'Failed to process work',
        };
      }

      return {
        success: true,
        submissionId: workId,
        metadata: {
          workId,
          processId: request.flowCode,
        },
      };
    } catch (error: any) {
      return {
        success: false,
        errorMessage: error.message,
      };
    }
  }

  /**
   * Query work status
   */
  async queryStatus(submissionId: string): Promise<StatusResult> {
    await this.ensureAuthenticated();

    try {
      // Get work detail
      const workResponse = await this.client.get(
        `/x_processplatform_assemble_surface/jaxrs/work/${submissionId}`,
      );

      if (workResponse.data.type !== 'success') {
        throw new Error(`Failed to get work: ${workResponse.data.message}`);
      }

      const work = workResponse.data.data;

      // Get work log
      const logResponse = await this.client.get(
        `/x_processplatform_assemble_surface/jaxrs/worklog/work/${submissionId}`,
      );

      const timeline: Array<{
        timestamp: string;
        status: string;
        operator?: string;
        comment?: string;
      }> = [];

      if (logResponse.data.type === 'success') {
        const logs = logResponse.data.data || [];
        for (const log of logs) {
          timeline.push({
            timestamp: log.createTime,
            status: log.routeName || log.activityName || 'unknown',
            operator: log.person,
            comment: log.opinion,
          });
        }
      }

      return {
        status: work.activityName || 'unknown',
        statusDetail: {
          workId: work.id,
          title: work.title,
          activityName: work.activityName,
          activityType: work.activityType,
          currentPerson: work.currentPerson,
        },
        timeline,
      };
    } catch (error: any) {
      return {
        status: 'error',
        statusDetail: {
          error: error.message,
        },
      };
    }
  }

  /**
   * Cancel work
   */
  async cancel(submissionId: string): Promise<CancelResult> {
    await this.ensureAuthenticated();

    try {
      const response = await this.client.delete(
        `/x_processplatform_assemble_surface/jaxrs/work/${submissionId}`,
      );

      if (response.data.type !== 'success') {
        return {
          success: false,
          message: response.data.message || 'Failed to cancel work',
        };
      }

      return {
        success: true,
        message: 'Work cancelled successfully',
      };
    } catch (error: any) {
      return {
        success: false,
        message: error.message,
      };
    }
  }

  /**
   * Urge work
   */
  async urge(submissionId: string): Promise<UrgeResult> {
    await this.ensureAuthenticated();

    try {
      const response = await this.client.post(
        `/x_processplatform_assemble_surface/jaxrs/work/${submissionId}/urge`,
        {},
      );

      if (response.data.type !== 'success') {
        return {
          success: false,
          message: response.data.message || 'Failed to urge work',
        };
      }

      return {
        success: true,
        message: 'Urge sent successfully',
      };
    } catch (error: any) {
      return {
        success: false,
        message: error.message,
      };
    }
  }

  private async ensureAuthenticated(): Promise<void> {
    if (!this.token) {
      await this.authenticate();
    }
  }
}
