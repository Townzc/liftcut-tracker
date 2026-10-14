import { evaluateWorkoutParser } from "../tests/helpers/workout-parser-eval";
const result = evaluateWorkoutParser();
console.log(JSON.stringify({kind:"synthetic_rules_development_evaluation",modelCalls:0,...result},null,2));
if(result.exact!==result.total || result.inventedNulls!==0 || result.falseDrafts!==0)process.exitCode=1;
