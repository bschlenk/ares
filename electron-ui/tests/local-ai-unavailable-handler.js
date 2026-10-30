// Test-only backend: explicitly unavailable; never performs or echoes inference.
import {localAIHandler,LanguageModelUtility} from 'electron';
class UnavailableModel extends LanguageModelUtility {
  static async availability(){return 'unavailable';}
  static async create(){throw new Error('test_provider_not_configured');}
}
localAIHandler.setPromptAPIHandler(()=>UnavailableModel);
process.parentPort.postMessage({ready:true});
