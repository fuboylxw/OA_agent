// O2OA 适配器实现示例
// 位置: packages/oa-adapters/src/o2oa-adapter.ts

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
  credential?: string;
  password?: string;
  token?: string;
}

export class O2OAAdapter implements OAAdapter {
  private client: AxiosInstance;
  private token: string | null = null;
  private config: O2OAConfig;

  constructor(config: O2OAConfig) {
    this.config = config;
    this.client = axios.create({
      baseURL: config.baseUrl,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // 如果提供了 token，直接使用
    if (config.token) {
      this.token = config.token;
      this.client.defaults.headers.common['x-token'] = config.token;
    }
  }

  /**
   * 认证登录
   */
  async authenticate(): Promise<void> {
    if (this.token) {
      return; // 已有 token，跳过认证
    }

    if (!this.config.credential || !this.config.password) {
      throw new Error('Missing credential or password for authentication');
    }

    try {
      const response = await this.client.post(
        '/x_organization_assemble_authentication/jaxrs/authentication',
        {
          credential: this.config.credential,
          password: this.config.password,
        }
      );

      if (response.data.type === 'success') {
        this.token = response.data.data.token;
        this.client.defaults.headers.common['x-token'] = this.token;
      } else {
        throw new Error(response.data.message || 'Authentication failed');
      }
    } catch (error: any) {
      throw new Error(`O2OA authentication failed: ${error.message}`);
    }
  }

  /**
   * 发现 OA 系统的流程和能力
   */
  async discover(): Promise<DiscoverResult> {
    await this.authenticate();

    try {
      // 1. 获取应用列表
      const appsResponse = await this.client.get(
        '/x_processplatform_assemble_surface/jaxrs/application/list'
      );

      if (appsResponse.data.type !== 'success') {
        throw new Error('Failed to fetch applications');
      }

      const applications = appsResponse.data.data || [];
      const discoveredFlows: Array<{
        flowCode: string;
        flowName: string;
        entryUrl?: string;
        submitUrl?: string;
        queryUrl?: string;
      }> = [];

      // 2. 获取每个应用的流程列表
      for (const app of applications) {
        const appFlag = app.alias || app.id;

        try {
          const processesResponse = await this.client.get(
            `/x_processplatform_assemble_surface/jaxrs/process/list/application/${appFlag}`
          );

          if (processesResponse.data.type === 'success') {
            const processes = processesResponse.data.data || [];

            for (const process of processes) {
              const processFlag = process.alias || process.id;

              discoveredFlows.push({
                flowCode: processFlag,
                flowName: process.name,
                entryUrl: `/x_processplatform_assemble_surface/jaxrs/work/process/${processFlag}`,
                submitUrl: `/x_processplatform_assemble_surface/jaxrs/work/process/${processFlag}`,
                queryUrl: `/x_processplatform_assemble_surface/jaxrs/work`,
              });
            }
          }
        } catch (error) {
          console.warn(`Failed to fetch processes for app ${appFlag}:`, error);
        }
      }

      return {
        oaVendor: 'O2OA',
        oaVersion: 'v8.x',
        oaType: 'openapi',
        authType: 'apikey',
        discoveredFlows,
      };
    } catch (error: any) {
      throw new Error(`O2OA discovery failed: ${error.message}`);
    }
  }

  /**
   * 健康检查
   */
  async healthCheck(): Promise<HealthCheckResult> {
    const start = Date.now();

    try {
      await this.authenticate();

      // 测试一个简单的 API 调用
      const response = await this.client.get(
        '/x_processplatform_assemble_surface/jaxrs/application/list'
      );

      const latencyMs = Date.now() - start;

      if (response.data.type === 'success') {
        return {
          healthy: true,
          latencyMs,
          message: 'O2OA system is healthy',
        };
      } else {
        return {
          healthy: false,
          latencyMs,
          message: response.data.message || 'Health check failed',
        };
      }
    } catch (error: any) {
      return {
        healthy: false,
        latencyMs: Date.now() - start,
        message: `Health check failed: ${error.message}`,
      };
    }
  }

  /**
   * 提交申请
   */
  async submit(request: SubmitRequest): Promise<SubmitResult> {
    await this.authenticate();

    try {
      const response = await this.client.post(
        `/x_processplatform_assemble_surface/jaxrs/work/process/${request.flowCode}`,
        {
          data: request.formData,
          title: request.formData.title || '新申请',
        }
      );

      if (response.data.type === 'success') {
        const workId = response.data.data.id || response.data.data.work;

        return {
          success: true,
          submissionId: workId,
          metadata: {
            workId,
            title: response.data.data.title,
            createdTime: response.data.data.createTime,
          },
        };
      } else {
        return {
          success: false,
          errorMessage: response.data.message || 'Submission failed',
        };
      }
    } catch (error: any) {
      return {
        success: false,
        errorMessage: `Submission failed: ${error.message}`,
      };
    }
  }

  /**
   * 查询申请状态
   */
  async queryStatus(submissionId: string): Promise<StatusResult> {
    await this.authenticate();

    try {
      // 1. 获取工作详情
      const workResponse = await this.client.get(
        `/x_processplatform_assemble_surface/jaxrs/work/${submissionId}`
      );

      if (workResponse.data.type !== 'success') {
        throw new Error('Failed to fetch work details');
      }

      const work = workResponse.data.data;

      // 2. 获取工作记录（审批历史）
      let timeline: Array<{
        timestamp: string;
        status: string;
        operator?: string;
        comment?: string;
      }> = [];

      try {
        const recordResponse = await this.client.get(
          `/x_processplatform_assemble_surface/jaxrs/record/list/workorworkcompleted/${submissionId}`
        );

        if (recordResponse.data.type === 'success') {
          const records = recordResponse.data.data || [];

          timeline = records.map((record: any) => ({
            timestamp: record.createTime || record.completedTime,
            status: record.activityName || record.routeName,
            operator: record.person,
            comment: record.opinion,
          }));
        }
      } catch (error) {
        console.warn('Failed to fetch work records:', error);
      }

      return {
        status: work.activityName || work.currentActivityName || 'unknown',
        statusDetail: {
          workId: work.id,
          title: work.title,
          createdTime: work.createTime,
          creatorPerson: work.creatorPerson,
          currentActivityName: work.activityName,
          processName: work.processName,
        },
        timeline,
      };
    } catch (error: any) {
      throw new Error(`Query status failed: ${error.message}`);
    }
  }

  /**
   * 取消申请
   */
  async cancel(submissionId: string): Promise<CancelResult> {
    await this.authenticate();

    try {
      // O2OA 取消工作需要先获取任务 ID
      const tasksResponse = await this.client.get(
        `/x_processplatform_assemble_surface/jaxrs/task/list/work/${submissionId}`
      );

      if (tasksResponse.data.type !== 'success' || !tasksResponse.data.data?.length) {
        return {
          success: false,
          message: 'No active task found for this work',
        };
      }

      const taskId = tasksResponse.data.data[0].id;

      // 处理任务，选择取消路由
      const response = await this.client.post(
        `/x_processplatform_assemble_surface/jaxrs/task/${taskId}/processing`,
        {
          routeName: 'cancel',
          opinion: '申请人取消',
          data: {},
        }
      );

      if (response.data.type === 'success') {
        return {
          success: true,
          message: 'Work cancelled successfully',
        };
      } else {
        return {
          success: false,
          message: response.data.message || 'Cancel failed',
        };
      }
    } catch (error: any) {
      return {
        success: false,
        message: `Cancel failed: ${error.message}`,
      };
    }
  }

  /**
   * 催办
   */
  async urge(submissionId: string): Promise<UrgeResult> {
    await this.authenticate();

    try {
      // O2OA 催办功能
      const response = await this.client.post(
        `/x_processplatform_assemble_surface/jaxrs/work/${submissionId}/urge`,
        {
          message: '请尽快处理',
        }
      );

      if (response.data.type === 'success') {
        return {
          success: true,
          message: 'Urge sent successfully',
        };
      } else {
        return {
          success: false,
          message: response.data.message || 'Urge failed',
        };
      }
    } catch (error: any) {
      return {
        success: false,
        message: `Urge failed: ${error.message}`,
      };
    }
  }

  /**
   * 获取流程表单定义
   */
  async getProcessForm(processFlag: string): Promise<any> {
    await this.authenticate();

    try {
      const response = await this.client.get(
        `/x_processplatform_assemble_surface/jaxrs/process/${processFlag}`
      );

      if (response.data.type === 'success') {
        return response.data.data;
      } else {
        throw new Error(response.data.message || 'Failed to fetch process form');
      }
    } catch (error: any) {
      throw new Error(`Get process form failed: ${error.message}`);
    }
  }

  /**
   * 获取我的待办任务
   */
  async getMyTasks(count: number = 20): Promise<any[]> {
    await this.authenticate();

    try {
      const response = await this.client.get(
        `/x_processplatform_assemble_surface/jaxrs/task/list//next/${count}`
      );

      if (response.data.type === 'success') {
        return response.data.data || [];
      } else {
        throw new Error(response.data.message || 'Failed to fetch tasks');
      }
    } catch (error: any) {
      throw new Error(`Get tasks failed: ${error.message}`);
    }
  }

  /**
   * 处理任务（审批）
   */
  async processTask(
    taskId: string,
    routeName: string,
    opinion: string,
    data: Record<string, any> = {}
  ): Promise<boolean> {
    await this.authenticate();

    try {
      const response = await this.client.post(
        `/x_processplatform_assemble_surface/jaxrs/task/${taskId}/processing`,
        {
          routeName,
          opinion,
          data,
        }
      );

      return response.data.type === 'success';
    } catch (error: any) {
      throw new Error(`Process task failed: ${error.message}`);
    }
  }
}

// 导出工厂函数
export function createO2OAAdapter(config: O2OAConfig): O2OAAdapter {
  return new O2OAAdapter(config);
}
