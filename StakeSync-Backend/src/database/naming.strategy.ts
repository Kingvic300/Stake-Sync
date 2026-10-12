import { DefaultNamingStrategy, type NamingStrategyInterface } from 'typeorm';

const snake = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();

/** camelCase properties, snake_case columns. */
export class SnakeNamingStrategy extends DefaultNamingStrategy implements NamingStrategyInterface {
  override columnName(propertyName: string, customName: string | undefined, prefixes: string[]) {
    return snake(prefixes.concat(customName ?? propertyName).join('_'));
  }
  override relationName(propertyName: string) {
    return snake(propertyName);
  }
  override joinColumnName(relationName: string, referencedColumnName: string) {
    return snake(`${relationName}_${referencedColumnName}`);
  }
  override joinTableColumnName(tableName: string, propertyName: string, columnName?: string) {
    return snake(`${tableName}_${columnName ?? propertyName}`);
  }
}
