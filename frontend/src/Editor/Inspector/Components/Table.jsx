import React from 'react';
import { renderElement, renderEvent, renderQuerySelector } from '../Utils';
import { computeActionName } from '@/_helpers/utils';
import SortableList, { SortableItem } from 'react-easy-sort';
import arrayMove from 'array-move';
import OverlayTrigger from 'react-bootstrap/OverlayTrigger';
import Popover from 'react-bootstrap/Popover';
import { EventSelector } from '../EventSelector';
import { Color } from '../Elements/Color';
import SelectSearch, { fuzzySearch } from 'react-select-search';

class Table extends React.Component {
  constructor(props) {
    super(props);

    const {
      dataQueries, component, paramUpdated, componentMeta, eventUpdated, eventOptionUpdated, components, currentState
    } = props;

    this.state = {
      dataQueries,
      component,
      paramUpdated,
      componentMeta,
      eventUpdated,
      eventOptionUpdated,
      components,
      currentState
    };
  }

  componentDidMount() {
    const {
      dataQueries,
      component,
      paramUpdated,
      componentMeta,
      eventUpdated,
      eventOptionUpdated,
      components,
      currentState
    } = this.props;

    this.setState({
      dataQueries,
      component,
      paramUpdated,
      componentMeta,
      eventUpdated,
      eventOptionUpdated,
      components,
      currentState
    });
  }

  onActionButtonPropertyChanged = (index, property, value) => {
    const actions = this.state.component.component.definition.properties.actions;
    actions.value[index][property] = value;
    this.props.paramUpdated({ name: 'actions' }, 'value', actions.value, 'properties');
  };

  actionButtonEventUpdated = (event, value, extraData) => {
    const actions = this.state.component.component.definition.properties.actions;
    const index = extraData.index;

    let newValues = actions.value;
    newValues[index][event.name] = {
      actionId: value
    };

    this.props.paramUpdated({ name: 'actions' }, 'value', newValues, 'properties');
  };

  actionButtonEventOptionUpdated = (event, option, value, extraData) => {
    const actions = this.state.component.component.definition.properties.actions;
    const index = extraData.index;

    let newValues = actions.value;
    const options = newValues[index][event.name].options;

    newValues[index][event.name].options = {
      ...options,
      [option]: value
    };

    this.props.paramUpdated({ name: 'actions' }, 'value', newValues, 'properties');
  };

  columnPopover = (column, index) => {
    return (
      <Popover id="popover-basic">
        <Popover.Content>
          <div className="field mb-2">
            <label className="form-label">Column type</label>
            <SelectSearch
              options={[
                { name: 'Default', value: 'default' },
                { name: 'String', value: 'string' },
                { name: 'Text', value: 'text' },
                { name: 'Badge', value: 'badge' },
                { name: 'Multiple badges', value: 'badges' },
                { name: 'Tags', value: 'tags' },
                { name: 'Dropdown', value: 'dropdown' },
                { name: 'Multiselect', value: 'multiselect' }
              ]}
              value={column.columnType}
              search={true}
              closeOnSelect={true}
              onChange={(value) => {
                this.onColumnItemChange(index, 'columnType', value);
              }}
              filterOptions={fuzzySearch}
              placeholder="Select.."
            />
          </div>
          <div className="field mb-2">
            <label className="form-label">Column name</label>
            <input
              type="text"
              className="form-control text-field"
              onBlur={(e) => {
                e.stopPropagation();
                this.onColumnItemChange(index, 'name', e.target.value);
              }}
              defaultValue={column.name}
            />
          </div>
          <div className="field mb-2">
            <label className="form-label">key</label>
            <input
              type="text"
              className="form-control text-field"
              onBlur={(e) => {
                e.stopPropagation();
                this.onColumnItemChange(index, 'key', e.target.value);
              }}
              defaultValue={column.key}
            />
          </div>

          {(column.columnType === 'dropdown' || column.columnType === 'multiselect' || column.columnType === 'badge' || column.columnType === 'badges') && (
            <div>
              <div className="field mb-2">
                <label className="form-label">Values</label>
                <input
                  type="text"
                  className="form-control text-field"
                  onChange={(e) => {
                    e.stopPropagation();
                    this.onColumnItemChange(index, 'values', e.target.value);
                  }}
                  value={column.values}
                  placeholder={'{{[1, 2, 3]}}'}
                />
              </div>
              <div className="field mb-2">
                <label className="form-label">Labels</label>
                <input
                  type="text"
                  className="form-control text-field"
                  onChange={(e) => {
                    e.stopPropagation();
                    this.onColumnItemChange(index, 'labels', e.target.value);
                  }}
                  value={column.labels}
                  placeholder={'{{["one", "two", "three"]}}'}
                />
              </div>
            </div>
          )}

          {column.columnType === 'string' || column.columnType === 'text' && (
            <label className="form-check form-switch my-2">
              <input
                className="form-check-input"
                type="checkbox"
                onClick={() => this.onColumnItemChange(index, 'isEditable', !column.isEditable)}
                checked={column.isEditable}
              />
              <span className="form-check-label">make editable</span>
            </label>
          )}

          <button className="btn btn-sm btn-outline-danger col" onClick={() => this.removeAction(index)}>
            Remove
          </button>
        </Popover.Content>
      </Popover>
    );
  };

  actionPopOver = (action, index) => {
    return (
      <Popover id="popover-basic">
        <Popover.Content>
          <div className="field mb-2">
            <label className="form-label">Button Text</label>
            <input
              type="text"
              className="form-control text-field"
              onChange={(e) => {
                e.stopPropagation();
                this.onActionButtonPropertyChanged(index, 'buttonText', e.target.value);
              }}
              value={action.buttonText}
            />
          </div>
          <Color
            param={{ name: 'actionButtonBackgroundColor' }}
            paramType="properties"
            componentMeta={this.state.componentMeta}
            definition={{ value: action.backgroundColor }}
            onChange={(name, value, color) => this.onActionButtonPropertyChanged(index, 'backgroundColor', color)}
          />

          <Color
            param={{ name: 'actionButtonTextColor' }}
            paramType="properties"
            componentMeta={this.state.componentMeta}
            definition={{ value: action.textColor }}
            onChange={(name, value, color) => this.onActionButtonPropertyChanged(index, 'textColor', color)}
          />
          <EventSelector
            param={{ name: 'onClick' }}
            eventMeta={{ displayName: 'On click' }}
            definition={action.onClick}
            eventUpdated={this.actionButtonEventUpdated}
            dataQueries={this.state.dataQueries}
            eventOptionUpdated={this.actionButtonEventOptionUpdated}
            currentState={this.state.currentState}
            extraData={{ actionButton: action, index: index }} // This data is returned in the callbacks
          />
          <button className="btn btn-sm btn-outline-danger col" onClick={() => this.removeAction(index)}>
            Remove
          </button>
        </Popover.Content>
      </Popover>
    );
  };

  actionButton(action, index) {
    return (
      <OverlayTrigger trigger="click" placement="left" rootClose overlay={this.actionPopOver(action, index)}>
        <div className="card p-2 bg-light" role="button">
          <div className="row bg-light">
            <div className="col-auto">
              <div className="text">{action.buttonText}</div>
            </div>
          </div>
        </div>
      </OverlayTrigger>
    );
  }

  onSortEnd = (oldIndex, newIndex) => {
    const columns = this.state.component.component.definition.properties.columns;
    const newColumns = arrayMove(columns.value, oldIndex, newIndex);
    this.props.paramUpdated({ name: 'columns' }, 'value', newColumns, 'properties');
  };

  generateNewColumnName = (columns) => {
    let found = false;
    let columnName = '';
    let currentNumber = 1;

    while (!found) {
      columnName = `new_column${currentNumber}`;
      if (columns.find(column => column.name === columnName) === undefined) {
        found = true;
      }
      currentNumber += 1;
    }

    return columnName;
  }

  addNewColumn = () => {
    const columns = this.state.component.component.definition.properties.columns;
    const newValue = columns.value;
    newValue.push({ name: this.generateNewColumnName(columns.value) });
    this.props.paramUpdated({ name: 'columns' }, 'value', newValue, 'properties');
  };

  addNewAction = () => {
    const actions = this.state.component.component.definition.properties.actions;
    const newValue = actions ? actions.value : [];
    newValue.push({ name: computeActionName(actions), buttonText: 'Button' });
    this.props.paramUpdated({ name: 'actions' }, 'value', newValue, 'properties');
  };

  removeAction = (index) => {
    const newValue = this.state.component.component.definition.properties.actions.value;
    newValue.splice(index, 1);
    this.props.paramUpdated({ name: 'actions' }, 'value', newValue, 'properties');
  };

  onColumnItemChange = (index, item, value) => {
    const columns = this.state.component.component.definition.properties.columns;
    const column = columns.value[index];

    if (item === 'name') {
      const columnSizes = this.state.component.component.definition.properties.columnSizes;

      if (columnSizes) {
        const newColumnSizes = JSON.parse(JSON.stringify(columnSizes));
        if (newColumnSizes[column.name]) {
          newColumnSizes[value] = newColumnSizes[column.name];
          this.props.paramUpdated({ name: 'columnSizes' }, null, newColumnSizes, 'properties');
        }
      }
    }

    column[item] = value;
    const newColumns = columns.value;
    newColumns[index] = column;

    this.props.paramUpdated({ name: 'columns' }, 'value', newColumns, 'properties');
  };

  removeColumn = (index) => {
    const columns = this.state.component.component.definition.properties.columns;
    const newValue = columns.value;
    newValue.splice(index, 1);
    this.props.paramUpdated({ name: 'columns' }, 'value', newValue, 'properties');
  };

  render() {
    const {
      dataQueries,
      component,
      paramUpdated,
      componentMeta,
      eventUpdated,
      eventOptionUpdated,
      components,
      currentState
    } = this.state;

    const columns = component.component.definition.properties.columns;
    const actions = component.component.definition.properties.actions || { value: [] };

    return (
      <div className="properties-container p-2">
        {renderElement(component, componentMeta, paramUpdated, dataQueries, 'data', 'properties', currentState, components)}

        <div className="field mb-2 mt-3">
          <div className="row g-2">
            <div className="col">
              <label className="form-label col pt-1">Columns</label>
            </div>
            <div className="col-auto">
              <button onClick={this.addNewColumn} className="btn btn-sm btn-outline-azure col-auto">
                + Add column
              </button>
            </div>
          </div>
          <div>
            <SortableList onSortEnd={this.onSortEnd} className="w-100" draggedItemClassName="dragged">
              {columns.value.map((item, index) => (
                <div className="card p-2 bg-light" key={index}>
                  <OverlayTrigger trigger="click" placement="left" rootClose overlay={this.columnPopover(item, index)}>
                    <div className="row bg-light" role="button">
                      <div className="col-auto">
                        <SortableItem key={item.name}>
                          <img
                            style={{ cursor: 'move' }}
                            src="https://www.svgrepo.com/show/20663/menu.svg"
                            width="10"
                            height="10"
                          />
                        </SortableItem>
                      </div>
                      <div className="col">
                        <div className="text">{item.name}</div>
                      </div>
                      <div className="col-auto">
                        <div className="btn btn-sm text-danger" onClick={() => this.removeColumn(index)}>
                          x
                        </div>
                      </div>
                    </div>
                  </OverlayTrigger>
                </div>
              ))}
            </SortableList>
          </div>

          <hr></hr>
          <div className="field mb-2 mt-2">
            <div className="row g-2">
              <div className="col">
                <label className="form-label col pt-1">Actions</label>
              </div>
              <div className="col-auto">
                <button onClick={this.addNewAction} className="btn btn-sm btn-outline-azure col-auto">
                  + Action
                </button>
              </div>
            </div>
            <div>{actions.value.map((action, index) => this.actionButton(action, index))}</div>
          </div>
          <hr></hr>

          {renderElement(component, componentMeta, paramUpdated, dataQueries, 'serverSidePagination', 'properties', currentState)}

          <hr></hr>

          {renderEvent(component, eventUpdated, dataQueries, eventOptionUpdated, 'onRowClicked', componentMeta.events.onRowClicked, currentState)}
          {renderEvent(component, eventUpdated, dataQueries, eventOptionUpdated, 'onPageChanged', componentMeta.events.onPageChanged, currentState)}

          {renderQuerySelector(component, dataQueries, eventOptionUpdated, 'onBulkUpdate', componentMeta.events.onBulkUpdate)}

          <hr></hr>
        </div>

        {renderElement(component, componentMeta, paramUpdated, dataQueries, 'visible', 'properties', currentState)}
        {renderElement(component, componentMeta, paramUpdated, dataQueries, 'loadingState', 'properties', currentState)}
        {renderElement(component, componentMeta, paramUpdated, dataQueries, 'textColor', 'styles', currentState)}
      </div>
    );
  }
}

export { Table };
