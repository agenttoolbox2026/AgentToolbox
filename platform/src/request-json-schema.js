// Zod refinements are omitted from JSON Schema conversion. Publish the existing
// input/prepared_id rule as metadata without changing parsing or payment flows.
export function inputOrPreparedMetadata(){
 return {oneOf:[
  {required:['input'],not:{required:['prepared_id']}},
  {required:['prepared_id'],not:{required:['input']}},
 ]};
}
export function inputOrPreparedJsonSchema(schema){
 return {...schema,...inputOrPreparedMetadata()};
}
